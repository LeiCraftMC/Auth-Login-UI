/**
 * Passkeys (port of the Zitadel login's `lib/server/passkeys.ts`): registration (with a session or
 * a registration code from an email link), verification, and login with a passkey.
 */
import { create, type JsonObject } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import { Logger } from "../utils/logger";
import { ZitadelAPI } from "../zitadel/api";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import { type Checks, ChecksSchema } from "../zitadel/proto/zitadel/session/v2/session_service_pb";
import {
	type RegisterPasskeyResponse,
	VerifyPasskeyRegistrationRequestSchema,
} from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import type { LoginContext } from "./context";
import { SessionCookies } from "./cookies";
import { LoginFlow } from "./flow";
import { LoginSecurity } from "./security";
import { LoginSessionActions } from "./sessionActions";
import { LoginSessionCookie } from "./sessionCookie";
import type { FlowResult } from "./types";
import { LoginUserAgent } from "./userAgent";
import { VerifyHelper } from "./verifyHelper";

export class LoginPasskeys {
	static async registerPasskeyLink(
		ctx: LoginContext,
		command: { sessionId?: string; userId?: string; code?: string; codeId?: string },
	): Promise<RegisterPasskeyResponse | { error: string }> {
		if (!command.sessionId && !command.userId) {
			return { error: "Either sessionId or userId must be provided" };
		}

		const serviceConfig = ctx.serviceConfig;
		const host = ctx.publicHost();

		let currentUserId: string | undefined;
		let registerCode: { id: string; code: string } | undefined;

		if (command.sessionId) {
			const sessionCookie = SessionCookies.getById(ctx, { sessionId: command.sessionId });
			if (!sessionCookie) {
				return { error: "Could not get session cookie" };
			}

			const session = await ZitadelAPI.getSession({
				serviceConfig,
				sessionId: sessionCookie.id,
				sessionToken: sessionCookie.token,
			});

			if (!session?.session?.factors?.user?.id) {
				return { error: "Could not determine user from session" };
			}
			currentUserId = session.session.factors.user.id;

			const enrollmentError = await LoginSecurity.getEnrollmentAuthorizationError(ctx, {
				serviceConfig,
				session: session.session,
				userId: currentUserId,
			});
			if (enrollmentError) return { error: enrollmentError };

			if (command.code && command.codeId) {
				registerCode = { id: command.codeId, code: command.code };
			} else {
				const codeResponse = await ZitadelAPI.createPasskeyRegistrationLink({
					serviceConfig,
					userId: currentUserId,
				});
				if (!codeResponse?.code?.code) {
					return { error: "Could not create registration link" };
				}
				registerCode = codeResponse.code;
			}
		} else if (command.userId && command.code && command.codeId) {
			currentUserId = command.userId;
			registerCode = { id: command.codeId, code: command.code };

			const userResponse = await ZitadelAPI.getUserByID({ serviceConfig, userId: currentUserId });
			if (!userResponse?.user) {
				return { error: "User not found" };
			}

			// a session to continue the flow after the registration
			const result = await LoginSessionCookie.createSessionAndUpdateCookie(ctx, {
				checks: create(ChecksSchema, {
					user: { search: { case: "loginName", value: userResponse.user.preferredLoginName } },
				}),
				requestId: undefined,
			});
			if (!result.session) {
				return { error: "Could not create session" };
			}
		}

		if (!registerCode) {
			throw new Error("Missing code in response");
		}

		const [hostname] = host.split(":");
		if (!hostname) throw new Error("Could not get hostname");
		if (!currentUserId) throw new Error("Could not determine user");

		return ZitadelAPI.registerPasskey({
			serviceConfig,
			userId: currentUserId,
			code: registerCode,
			domain: hostname,
		});
	}

	static async verifyPasskeyRegistration(
		ctx: LoginContext,
		command: {
			passkeyId: string;
			passkeyName?: string;
			publicKeyCredential: JsonObject;
			sessionId?: string;
			userId?: string;
		},
	) {
		const serviceConfig = ctx.serviceConfig;

		if (!command.sessionId && !command.userId) {
			throw new Error("Either sessionId or userId must be provided");
		}

		const passkeyName = command.passkeyName || LoginUserAgent.authenticatorName(ctx);

		let loginName: string | undefined;
		let currentUserId: string;

		if (command.sessionId) {
			const sessionCookie = SessionCookies.getById(ctx, { sessionId: command.sessionId });
			if (!sessionCookie) throw new Error("Could not get session cookie");

			const session = await ZitadelAPI.getSession({
				serviceConfig,
				sessionId: sessionCookie.id,
				sessionToken: sessionCookie.token,
			});
			const userId = session?.session?.factors?.user?.id;
			if (!userId) throw new Error("Could not get session");

			currentUserId = userId;
			loginName = session?.session?.factors?.user?.loginName;
		} else {
			currentUserId = command.userId as string;
			const userResponse = await ZitadelAPI.getUserByID({ serviceConfig, userId: currentUserId });
			if (!userResponse?.user) throw new Error("User not found");
			loginName = userResponse.user.preferredLoginName;
		}

		const response = await ZitadelAPI.verifyPasskeyRegistration({
			serviceConfig,
			request: create(VerifyPasskeyRegistrationRequestSchema, {
				passkeyId: command.passkeyId,
				publicKeyCredential: command.publicKeyCredential,
				passkeyName,
				userId: currentUserId,
			}),
		});

		return { ...response, loginName };
	}

	/** Verifies a passkey assertion on the session and continues the flow. */
	static async sendPasskey(
		ctx: LoginContext,
		command: {
			loginName?: string;
			sessionId?: string;
			organization?: string;
			checks?: Checks;
			requestId?: string;
			lifetime?: Duration;
		},
	): Promise<FlowResult> {
		const { loginName, sessionId, organization, checks, requestId } = command;
		const t = await ctx.t("passkey");
		const serviceConfig = ctx.serviceConfig;

		const result = await LoginSessionActions.updateOrCreateSession(ctx, {
			loginName,
			sessionId,
			organization,
			checks,
			requestId,
			lifetime: command.lifetime,
		});

		if ("error" in result) {
			return { error: result.error };
		}

		const session = { id: result.sessionId, factors: result.factors } as Partial<Session> & {
			id: string;
		};

		const loginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization });

		const userId = session.factors?.user?.id;
		if (!userId) {
			return { error: t("verify.errors.couldNotFindSession") };
		}

		let userResponse: Awaited<ReturnType<typeof ZitadelAPI.getUserByID>>;
		try {
			userResponse = await ZitadelAPI.getUserByID({ serviceConfig, userId });
		} catch (error) {
			Logger.error("Error fetching user by ID:", error);
			return { error: t("verify.errors.couldNotGetUser") };
		}

		if (!userResponse.user) {
			return { error: t("verify.errors.userNotFound") };
		}

		const humanUser = userResponse.user.type.case === "human" ? userResponse.user.type.value : undefined;

		const emailVerificationCheck = await VerifyHelper.checkEmailVerification(
			ctx,
			session,
			humanUser,
			organization,
			requestId,
		);
		if (emailVerificationCheck?.redirect) return emailVerificationCheck;

		if (requestId && session.id) {
			return LoginFlow.completeFlowOrGetUrl(
				ctx,
				{ sessionId: session.id, requestId, organization },
				loginSettings?.defaultRedirectUri,
			);
		}
		if (session.factors?.user?.loginName) {
			return LoginFlow.completeFlowOrGetUrl(
				ctx,
				{ loginName: session.factors.user.loginName, organization },
				loginSettings?.defaultRedirectUri,
			);
		}

		return { error: t("verify.errors.couldNotDetermineRedirect") };
	}
}
