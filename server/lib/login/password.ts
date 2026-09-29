/**
 * Password steps (port of the Zitadel login's `lib/server/password.ts`): verify a password,
 * request a reset link, set a password with a code / after verification, change it with the
 * current one.
 */
import { create } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { Logger } from "../utils/logger";
import { type Translate, ZitadelAPI } from "../zitadel/api";
import { isClassifiedError } from "../zitadel/errors";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import { type Checks, ChecksSchema } from "../zitadel/proto/zitadel/session/v2/session_service_pb";
import type { LoginSettings } from "../zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { type User, UserState } from "../zitadel/proto/zitadel/user/v2/user_pb";
import { SetPasswordRequestSchema } from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import { LoginContext } from "./context";
import { LoginCookies, type SessionCookie, SessionCookies } from "./cookies";
import { LoginFlow } from "./flow";
import { MFA } from "./mfa";
import { isFailedAttemptsError, LoginSessionCookie } from "./sessionCookie";
import type { FlowResult } from "./types";
import { VerifyHelper } from "./verifyHelper";

const DEFAULT_LIFETIME = { seconds: BigInt(60 * 60 * 24), nanos: 0 } as Duration;

const ENUMERATION_DELAY_MS = 2000;

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LoginPassword {
	/** "You had X of Y attempts" (+ locked message), or the enumeration-safe variant. */
	private static async failedAttemptsMessage(
		ctx: LoginContext,
		t: Translate,
		failedAttempts: number,
		orgId: string | undefined,
	) {
		const lockoutSettings = await ZitadelAPI.getLockoutSettings({ serviceConfig: ctx.serviceConfig, orgId });
		const maxAttempts = lockoutSettings?.maxPasswordAttempts;
		const hasLimit = maxAttempts !== undefined && maxAttempts > BigInt(0);
		const locked = hasLimit && BigInt(failedAttempts) >= (maxAttempts as bigint);

		return t(hasLimit ? "errors.failedToAuthenticate" : "errors.failedToAuthenticateNoLimit", {
			failedAttempts,
			maxPasswordAttempts: hasLimit ? String(maxAttempts ?? 0) : "?",
			lockoutMessage: locked ? t("errors.accountLockedContactAdmin") : "",
		});
	}

	static async resetPassword(
		ctx: LoginContext,
		command: { loginName: string; organization?: string; defaultOrganization?: string; requestId?: string },
	): Promise<{ error?: string }> {
		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("password");

		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: command.organization ?? command.defaultOrganization,
		});

		if (!loginSettings) return { error: t("errors.couldNotSendResetLink") };
		if (loginSettings.hidePasswordReset) return { error: t("errors.passwordResetNotAllowed") };

		const searchResult = await ZitadelAPI.searchUsers({
			serviceConfig,
			searchValue: command.loginName,
			organizationId: command.organization,
			loginSettings,
			t: await ctx.t("zitadel"),
		});

		const hideUnknown = async (settings: LoginSettings | undefined) => {
			if (settings?.ignoreUnknownUsernames) {
				await delay(ENUMERATION_DELAY_MS);
				return {};
			}
			return { error: t("errors.couldNotSendResetLink") };
		};

		if (
			!searchResult ||
			!("result" in searchResult) ||
			!searchResult.result ||
			searchResult.result.length !== 1 ||
			!searchResult.result[0]?.userId
		) {
			return hideUnknown(loginSettings);
		}

		const user = searchResult.result[0];
		const humanUser = user.type.case === "human" ? user.type.value : undefined;

		const userLoginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: user.details?.resourceOwner,
		});

		if (userLoginSettings?.disableLoginWithEmail && userLoginSettings?.disableLoginWithPhone) {
			if (user.preferredLoginName !== command.loginName) return hideUnknown(userLoginSettings);
		} else if (userLoginSettings?.disableLoginWithEmail) {
			if (user.preferredLoginName !== command.loginName && humanUser?.phone?.phone !== command.loginName) {
				return hideUnknown(userLoginSettings);
			}
		} else if (userLoginSettings?.disableLoginWithPhone) {
			if (user.preferredLoginName !== command.loginName && humanUser?.email?.email !== command.loginName) {
				return hideUnknown(userLoginSettings);
			}
		}

		await ZitadelAPI.passwordReset({
			serviceConfig,
			userId: user.userId,
			urlTemplate:
				`${ctx.publicHostWithProtocol()}${LoginContext.getBasePath()}/password/set?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}` +
				(command.requestId ? `&requestId=${command.requestId}` : ""),
		});
		return {};
	}

	static async sendPassword(
		ctx: LoginContext,
		command: {
			loginName: string;
			organization?: string;
			defaultOrganization?: string;
			checks: Checks;
			requestId?: string;
		},
	): Promise<FlowResult> {
		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("password");

		let sessionCookie: SessionCookie | undefined = SessionCookies.getByLoginName(ctx, {
			loginName: command.loginName,
			organization: command.organization,
		});

		let session: Session | undefined;
		let user: User | undefined;
		let loginSettingsByContext: LoginSettings | undefined;
		let loginSettingsByUser: LoginSettings | undefined;

		// policy check on the context settings first
		if (!sessionCookie) {
			loginSettingsByContext = await ZitadelAPI.getLoginSettings({
				serviceConfig,
				organization: command.organization ?? command.defaultOrganization,
			});
			if (loginSettingsByContext && !loginSettingsByContext.allowLocalAuthentication) {
				return { error: t("errors.localAuthenticationNotAllowed") };
			}
		}

		if (sessionCookie) {
			try {
				loginSettingsByUser = await ZitadelAPI.getLoginSettings({
					serviceConfig,
					organization: sessionCookie.organization,
				});
				if (!loginSettingsByUser) throw new Error("Could not load login settings");

				let lifetime = loginSettingsByUser.passwordCheckLifetime;
				if (!lifetime || !lifetime.seconds) {
					Logger.warn("No password lifetime provided, defaulting to 24 hours");
					lifetime = DEFAULT_LIFETIME;
				}

				session = await LoginSessionCookie.setSessionAndUpdateCookie(ctx, {
					recentCookie: sessionCookie,
					checks: command.checks,
					requestId: command.requestId,
					lifetime,
				});
			} catch {
				// e.g. the session was terminated — fall back to creating a new one
				Logger.warn("[Password] Could not update session");
				sessionCookie = undefined;
				session = undefined;
			}
		}

		if (!sessionCookie) {
			loginSettingsByContext ??= await ZitadelAPI.getLoginSettings({
				serviceConfig,
				organization: command.organization ?? command.defaultOrganization,
			});

			if (!loginSettingsByContext) {
				// fake error to hide that the user does not even exist
				return { error: t("errors.couldNotVerifyPassword") };
			}

			const searchResult = await ZitadelAPI.searchUsers({
				serviceConfig,
				searchValue: command.loginName,
				organizationId: command.organization,
				loginSettings: loginSettingsByContext,
				t: await ctx.t("zitadel"),
			});

			const found =
				searchResult && "result" in searchResult && searchResult.result?.length === 1
					? searchResult.result[0]
					: undefined;

			if (!found?.userId) {
				// fake error to hide that the user does not even exist
				if (loginSettingsByContext.ignoreUnknownUsernames) {
					return { error: t("errors.failedToAuthenticateNoLimit") };
				}
				return { error: t("errors.couldNotVerifyPassword") };
			}

			user = found;
			const humanUser = user.type.case === "human" ? user.type.value : undefined;
			const userLoginSettings = await ZitadelAPI.getLoginSettings({
				serviceConfig,
				organization: user.details?.resourceOwner,
			});

			// emulate "user not found" (context settings, not user settings) on a login-name mismatch
			const mismatch = () =>
				loginSettingsByContext?.ignoreUnknownUsernames
					? { error: t("errors.failedToAuthenticateNoLimit") }
					: { error: t("errors.couldNotVerifyPassword") };

			if (userLoginSettings?.disableLoginWithEmail && userLoginSettings?.disableLoginWithPhone) {
				if (user.preferredLoginName !== command.loginName) return mismatch();
			} else if (userLoginSettings?.disableLoginWithEmail) {
				if (user.preferredLoginName !== command.loginName && humanUser?.phone?.phone !== command.loginName) {
					return mismatch();
				}
			} else if (userLoginSettings?.disableLoginWithPhone) {
				if (user.preferredLoginName !== command.loginName && humanUser?.email?.email !== command.loginName) {
					return mismatch();
				}
			}

			try {
				const result = await LoginSessionCookie.createSessionAndUpdateCookie(ctx, {
					checks: create(ChecksSchema, {
						user: { search: { case: "userId", value: user.userId } },
						password: { password: command.checks.password?.password },
					}),
					requestId: command.requestId,
					lifetime: loginSettingsByContext.passwordCheckLifetime,
				});
				session = result.session;
				sessionCookie = result.sessionCookie;
			} catch (error) {
				if (isFailedAttemptsError(error)) {
					if (loginSettingsByContext.ignoreUnknownUsernames) {
						return { error: t("errors.failedToAuthenticateNoLimit") };
					}
					return {
						error: await LoginPassword.failedAttemptsMessage(
							ctx,
							t,
							error.failedAttempts,
							command.organization,
						),
					};
				}
				if (loginSettingsByContext.ignoreUnknownUsernames) {
					return { error: t("errors.failedToAuthenticateNoLimit") };
				}
				return { error: t("errors.couldNotCreateSessionForUser") };
			}
		}

		if (!session?.factors?.user?.id || !sessionCookie) {
			if (loginSettingsByContext?.ignoreUnknownUsernames) {
				return { error: t("errors.failedToAuthenticateNoLimit") };
			}
			return { error: t("errors.couldNotCreateSessionForUser") };
		}

		if (!user) {
			const userResponse = await ZitadelAPI.getUserByID({ serviceConfig, userId: session.factors.user.id });
			if (!userResponse.user) {
				return { error: t("errors.userNotFound") };
			}
			user = userResponse.user;
		}

		loginSettingsByUser ??= await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: command.organization ?? session.factors?.user?.organizationId ?? command.defaultOrganization,
		});

		const humanUser = user.type.case === "human" ? user.type.value : undefined;

		const expirySettings = await ZitadelAPI.getPasswordExpirySettings({
			serviceConfig,
			orgId: command.organization ?? session.factors?.user?.organizationId,
		});

		// must the password be changed first?
		const passwordChangedCheck = VerifyHelper.checkPasswordChangeRequired(
			expirySettings,
			session,
			humanUser,
			command.organization,
			command.requestId,
		);
		if (passwordChangedCheck?.redirect) return passwordChangedCheck;

		if (user.state === UserState.INITIAL) {
			return { error: t("errors.initialUserNotSupported") };
		}

		const emailVerificationCheck = await VerifyHelper.checkEmailVerification(
			ctx,
			session,
			humanUser,
			command.organization,
			command.requestId,
		);
		if (emailVerificationCheck?.redirect) return emailVerificationCheck;

		let authMethods: Awaited<ReturnType<typeof ZitadelAPI.listAuthenticationMethodTypes>>["authMethodTypes"] | undefined;
		if (command.checks?.password && session.factors?.user?.id) {
			const response = await ZitadelAPI.listAuthenticationMethodTypes({
				serviceConfig,
				userId: session.factors.user.id,
			});
			if (response.authMethodTypes?.length) authMethods = response.authMethodTypes;
		}

		if (!authMethods) {
			return { error: t("errors.couldNotVerifyPassword") };
		}

		const mfaFactorCheck = await MFA.checkMFAFactors(
			serviceConfig,
			session,
			loginSettingsByUser,
			authMethods,
			command.organization,
			command.requestId,
		);
		if (mfaFactorCheck?.redirect) return mfaFactorCheck;

		if (command.requestId && session.id) {
			return LoginFlow.completeFlowOrGetUrl(
				ctx,
				{
					sessionId: session.id,
					requestId: command.requestId,
					organization: command.organization ?? session.factors?.user?.organizationId,
				},
				loginSettingsByUser?.defaultRedirectUri,
			);
		}

		return LoginFlow.completeFlowOrGetUrl(
			ctx,
			{
				loginName: session.factors.user.loginName,
				organization: session.factors?.user?.organizationId,
			},
			loginSettingsByUser?.defaultRedirectUri,
		);
	}

	/** Sets a password with a code, or (without a code) after a user-verification check. */
	static async changePassword(
		ctx: LoginContext,
		command: { code?: string; userId: string; password: string; organization?: string },
	): Promise<{ error?: string }> {
		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("password");

		let user: User | undefined;
		try {
			user = (await ZitadelAPI.getUserByID({ serviceConfig, userId: command.userId })).user;
		} catch {
			// unknown ids (incl. the enumeration placeholder) make the Zitadel login's action throw,
			// which its form reports as "could not set password"
			return { error: t("set.errors.couldNotSetPassword") };
		}

		if (!user || user.userId !== command.userId) {
			const loginSettings = await ZitadelAPI.getLoginSettings({
				serviceConfig,
				organization: command.organization,
			});
			if (loginSettings?.ignoreUnknownUsernames) {
				return { error: t("set.errors.couldNotSetPassword") };
			}
			return { error: t("errors.couldNotSendResetLink") };
		}

		if (user.state === UserState.INITIAL) {
			return { error: t("errors.userInitialStateNotSupported") };
		}

		// without a code, only users without any auth method and a valid verification may set one
		if (!command.code) {
			const authMethods = await ZitadelAPI.listAuthenticationMethodTypes({ serviceConfig, userId: user.userId });
			if (authMethods.authMethodTypes.length !== 0) {
				return { error: t("errors.codeOrVerificationRequired") };
			}
			if (!LoginCookies.checkUserVerification(ctx, user.userId)) {
				return { error: t("errors.verificationRequired") };
			}
		}

		const result = await ZitadelAPI.setUserPassword({
			serviceConfig,
			userId: user.userId,
			password: command.password,
			code: command.code,
		});
		if (result && "error" in result && typeof result.error === "string") {
			return { error: result.error };
		}
		return {};
	}

	/** Changes the password of a session's user after re-checking the current password. */
	static async checkSessionAndSetPassword(
		ctx: LoginContext,
		{ sessionId, currentPassword, password }: { sessionId: string; currentPassword: string; password: string },
	): Promise<{ error?: string }> {
		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("password");

		const sessionCookie = SessionCookies.getById(ctx, { sessionId });
		if (!sessionCookie) {
			return { error: "Could not load session cookie" };
		}

		let session: Session | undefined;
		try {
			const sessionResponse = await ZitadelAPI.getSession({
				serviceConfig,
				sessionId: sessionCookie.id,
				sessionToken: sessionCookie.token,
			});
			session = sessionResponse.session;
		} catch (error) {
			Logger.error("Error getting session:", error);
			return { error: "Could not load session" };
		}

		if (!session?.factors?.user?.id) {
			return { error: t("errors.couldNotLoadSession") };
		}

		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: sessionCookie.organization,
		});

		let lifetime = loginSettings?.passwordCheckLifetime;
		if (!lifetime || !lifetime.seconds) lifetime = DEFAULT_LIFETIME;

		try {
			await LoginSessionCookie.setSessionAndUpdateCookie(ctx, {
				recentCookie: sessionCookie,
				checks: create(ChecksSchema, { password: { password: currentPassword } }),
				lifetime,
				requestId: sessionCookie.requestId,
			});
		} catch (error) {
			if (isFailedAttemptsError(error)) {
				if (loginSettings?.ignoreUnknownUsernames) {
					return { error: t("errors.failedToAuthenticateNoLimit") };
				}
				return {
					error: await LoginPassword.failedAttemptsMessage(
						ctx,
						t,
						error.failedAttempts,
						sessionCookie.organization,
					),
				};
			}
			if (loginSettings?.ignoreUnknownUsernames) {
				return { error: t("change.errors.couldNotVerifyPassword") };
			}
			return { error: t("change.errors.currentPasswordInvalid") };
		}

		try {
			await ZitadelAPI.setPassword({
				serviceConfig,
				payload: create(SetPasswordRequestSchema, {
					userId: session.factors.user.id,
					newPassword: { password },
				}),
			});
			return {};
		} catch (error) {
			// failed precondition (e.g. the user is not initialized yet)
			if (isClassifiedError(error) && error.code === Code.FailedPrecondition && error.message) {
				return { error: t("errors.failedPrecondition") };
			}
			return { error: "Could not set password" };
		}
	}
}
