/**
 * Email / invite verification and TOTP registration check (port of the Zitadel login's
 * `lib/server/verify.ts`).
 */
import { create } from "@bufbuild/protobuf";
import { Logger } from "../utils/logger";
import { ZitadelAPI } from "../zitadel/api";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import { ChecksSchema } from "../zitadel/proto/zitadel/session/v2/session_service_pb";
import { AuthenticationMethodType } from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import { LoginContext } from "./context";
import { LoginCookies, SessionCookies } from "./cookies";
import { LoginFlow } from "./flow";
import { MFA } from "./mfa";
import { LoginSecurity } from "./security";
import { LoginSessions } from "./session";
import { LoginSessionCookie } from "./sessionCookie";
import type { FlowResult } from "./types";

export class LoginVerify {
	/** Confirms a TOTP registration with the first code (needs an authorized session). */
	static async verifyTOTP(ctx: LoginContext, code: string, loginName?: string, organization?: string) {
		const session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		if (!session?.factors?.user?.id) {
			throw new Error("No user id found in session.");
		}

		const enrollmentError = await LoginSecurity.getEnrollmentAuthorizationError(ctx, {
			serviceConfig: ctx.serviceConfig,
			session,
			userId: session.factors.user.id,
		});
		if (enrollmentError) {
			return { error: enrollmentError };
		}

		await ZitadelAPI.verifyTOTPRegistration({
			serviceConfig: ctx.serviceConfig,
			code,
			userId: session.factors.user.id,
		});
		return {};
	}

	static async sendVerification(
		ctx: LoginContext,
		command: {
			userId: string;
			loginName?: string; // to determine an already existing session
			organization?: string;
			code: string;
			isInvite: boolean;
			requestId?: string;
		},
	): Promise<FlowResult> {
		const t = await ctx.t("verify");
		const serviceConfig = ctx.serviceConfig;

		try {
			if (command.isInvite) {
				await ZitadelAPI.verifyInviteCode({
					serviceConfig,
					userId: command.userId,
					verificationCode: command.code,
				});
			} else {
				await ZitadelAPI.verifyEmail({ serviceConfig, userId: command.userId, verificationCode: command.code });
			}
		} catch (error) {
			Logger.warn(command.isInvite ? "Could not verify invite:" : "Could not verify email:", error);
			return { error: t(command.isInvite ? "errors.couldNotVerifyInvite" : "errors.couldNotVerifyEmail") };
		}

		const userResponse = await ZitadelAPI.getUserByID({ serviceConfig, userId: command.userId });
		if (!userResponse?.user) {
			return { error: t("errors.couldNotLoadUser") };
		}
		const user = userResponse.user;

		let session: Session | undefined;
		const sessionCookie = SessionCookies.getByLoginName(ctx, {
			loginName: command.loginName ?? user.preferredLoginName,
			organization: command.organization,
		});

		if (sessionCookie) {
			session = await ZitadelAPI.getSession({
				serviceConfig,
				sessionId: sessionCookie.id,
				sessionToken: sessionCookie.token,
			})
				.then((response) => response?.session ?? undefined)
				.catch((error) => {
					Logger.warn("[verify] user session is not found, so we create a new one", error);
					return undefined;
				});
		}

		const authMethodResponse = await ZitadelAPI.listAuthenticationMethodTypes({
			serviceConfig,
			userId: user.userId,
		});
		if (!authMethodResponse?.authMethodTypes) {
			return { error: t("errors.couldNotLoadAuthenticators") };
		}

		const hasPrimaryMethod = authMethodResponse.authMethodTypes.some(
			(m) =>
				m === AuthenticationMethodType.PASSWORD ||
				m === AuthenticationMethodType.PASSKEY ||
				m === AuthenticationMethodType.IDP,
		);

		// no primary auth method yet: set one up
		if (!hasPrimaryMethod) {
			if (!session) {
				const result = await LoginSessionCookie.createSessionAndUpdateCookie(ctx, {
					checks: create(ChecksSchema, {
						user: { search: { case: "loginName", value: user.preferredLoginName } },
					}),
					requestId: command.requestId,
				});
				session = result.session;
			}

			if (!session) {
				return { error: t("errors.couldNotCreateSession") };
			}

			const params = new URLSearchParams({ sessionId: session.id });
			if (session.factors?.user?.loginName) params.set("loginName", session.factors.user.loginName);
			if (command.requestId) params.set("requestId", command.requestId);

			// bind the verification to this browser (hash of user id + fingerprint)
			LoginCookies.setVerificationCheck(ctx, user.userId);

			return { redirect: `/authenticator/set?${params}` };
		}

		// without a session only show the success page
		if (!session?.factors?.user?.id) {
			const params = new URLSearchParams({});
			if (command.userId) params.set("userId", command.userId);
			if (command.loginName || user.preferredLoginName) {
				params.set("loginName", command.loginName ? command.loginName : user.preferredLoginName);
			}
			if (command.requestId) params.set("requestId", command.requestId);
			if (command.organization) params.set("organization", command.organization);
			return { redirect: `/verify/success?${params}` };
		}

		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: user.details?.resourceOwner,
		});

		const mfaFactorCheck = await MFA.checkMFAFactors(
			serviceConfig,
			session,
			loginSettings,
			authMethodResponse.authMethodTypes,
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
				loginSettings?.defaultRedirectUri,
			);
		}

		return LoginFlow.completeFlowOrGetUrl(
			ctx,
			{
				loginName: session.factors.user.loginName,
				organization: session.factors?.user?.organizationId,
			},
			loginSettings?.defaultRedirectUri,
		);
	}

	static buildVerificationUrlTemplate(ctx: LoginContext, isInvite: boolean, requestId?: string) {
		let urlTemplate = `${ctx.publicHostWithProtocol()}${LoginContext.getBasePath()}/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}`;
		if (isInvite) urlTemplate += "&invite=true";
		if (requestId) urlTemplate += `&requestId=${encodeURIComponent(requestId)}`;
		return urlTemplate;
	}

	static async resendVerification(
		ctx: LoginContext,
		command: { userId: string; isInvite: boolean; requestId?: string },
	): Promise<{ error?: string }> {
		const t = await ctx.t("verify");
		const urlTemplate = LoginVerify.buildVerificationUrlTemplate(ctx, command.isInvite, command.requestId);

		if (command.isInvite) {
			try {
				await ZitadelAPI.createInviteCode({ serviceConfig: ctx.serviceConfig, userId: command.userId, urlTemplate });
				return {};
			} catch (error: any) {
				if (error?.code === 9) return { error: t("errors.userAlreadyVerified") };
				return { error: t("errors.couldNotResendInvite") };
			}
		}

		await ZitadelAPI.sendEmailCode({ serviceConfig: ctx.serviceConfig, userId: command.userId, urlTemplate });
		return {};
	}

	/** Sends the initial verification email / invite code; `false` on error (logged). */
	static async trySendVerification(
		ctx: LoginContext,
		command: { userId: string; isInvite: boolean; requestId?: string },
	): Promise<boolean> {
		try {
			const urlTemplate = LoginVerify.buildVerificationUrlTemplate(ctx, command.isInvite, command.requestId);

			if (command.isInvite) {
				await ZitadelAPI.createInviteCode({ serviceConfig: ctx.serviceConfig, userId: command.userId, urlTemplate });
			} else {
				await ZitadelAPI.sendEmailCode({ serviceConfig: ctx.serviceConfig, userId: command.userId, urlTemplate });
			}

			Logger.info("Verification email sent successfully", {
				userId: command.userId,
				isInvite: command.isInvite,
			});
			return true;
		} catch (error) {
			Logger.error("Failed to send verification email", { userId: command.userId, error });
			return false;
		}
	}
}
