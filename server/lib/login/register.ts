/**
 * Self-registration (port of the Zitadel login's `lib/server/register.ts`): register with password
 * or passkey, or complete a registration started at an external IdP.
 */
import { create } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { Logger } from "../utils/logger";
import { ZitadelAPI } from "../zitadel/api";
import { type Checks, ChecksSchema } from "../zitadel/proto/zitadel/session/v2/session_service_pb";
import type { LoginContext } from "./context";
import { LoginCookies } from "./cookies";
import { LoginFlow } from "./flow";
import { MFA } from "./mfa";
import { LoginSessionCookie } from "./sessionCookie";
import type { FlowResult } from "./types";
import { VerifyHelper } from "./verifyHelper";

const MAX_SESSION_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000];

export class LoginRegister {
	/**
	 * Right after the user is created, the projections (users, login_names) may lag behind:
	 * retry on NotFound with increasing delays.
	 */
	private static async createSessionWithRetry(
		ctx: LoginContext,
		command: { checks: Checks; requestId: string | undefined; lifetime?: Duration },
	) {
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_SESSION_RETRIES; attempt++) {
			try {
				return await LoginSessionCookie.createSessionAndUpdateCookie(ctx, command);
			} catch (error) {
				lastError = error;
				const isNotFound = error instanceof ConnectError && error.code === Code.NotFound;
				if (!isNotFound || attempt + 1 >= MAX_SESSION_RETRIES) throw error;

				const delay = RETRY_DELAYS_MS[attempt] ?? 2000;
				Logger.warn(
					`Session creation failed with NotFound (attempt ${attempt + 1}/${MAX_SESSION_RETRIES}), retrying in ${delay}ms...`,
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
		throw lastError;
	}

	static async registerUser(
		ctx: LoginContext,
		command: {
			email: string;
			firstName: string;
			lastName: string;
			password?: string;
			organization: string;
			requestId?: string;
		},
	): Promise<FlowResult> {
		const t = await ctx.t("register");
		const serviceConfig = ctx.serviceConfig;

		const loginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization: command.organization });

		if (!loginSettings) return { error: t("errors.couldNotGetLoginSettings") };
		if (!loginSettings.allowRegister) return { error: t("errors.registerNotAllowed") };
		if (command.password && !loginSettings.allowLocalAuthentication) {
			return { error: t("errors.localAuthenticationNotAllowed") };
		}

		const addResponse = await ZitadelAPI.addHumanUser({
			serviceConfig,
			email: command.email,
			firstName: command.firstName,
			lastName: command.lastName,
			password: command.password ? command.password : undefined,
			organization: command.organization,
		}).catch((error) => {
			Logger.error("Failed to create user", error);
			return null;
		});

		if (!addResponse) return { error: t("errors.couldNotCreateUser") };

		const checks = create(ChecksSchema, {
			user: { search: { case: "userId", value: addResponse.userId } },
			...(command.password ? { password: { password: command.password } } : {}),
		});

		const result = await LoginRegister.createSessionWithRetry(ctx, {
			checks,
			requestId: command.requestId,
			lifetime: command.password ? loginSettings.passwordCheckLifetime : undefined,
		}).catch((error) => {
			Logger.error("Failed to create session after user creation", error);
			return null;
		});

		const session = result?.session;
		if (!session?.factors?.user) return { error: t("errors.couldNotCreateSession") };

		if (!command.password) {
			const params = new URLSearchParams({
				loginName: session.factors.user.loginName,
				organization: session.factors.user.organizationId,
			});
			if (command.requestId) params.append("requestId", command.requestId);

			// passkey registration may proceed without another verification
			LoginCookies.setVerificationCheck(ctx, session.factors.user.id);

			return { redirect: `/passkey/set?${params}` };
		}

		const userResponse = await ZitadelAPI.getUserByID({ serviceConfig, userId: session.factors.user.id }).catch(
			(error) => {
				Logger.error("Failed to get user after session creation", error);
				return null;
			},
		);
		if (!userResponse?.user) return { error: t("errors.userNotFound") };

		const humanUser = userResponse.user.type.case === "human" ? userResponse.user.type.value : undefined;

		const emailVerificationCheck = await VerifyHelper.checkEmailVerification(
			ctx,
			session,
			humanUser,
			session.factors.user.organizationId,
			command.requestId,
		);
		if (emailVerificationCheck?.redirect) return emailVerificationCheck;

		return LoginFlow.completeFlowOrGetUrl(
			ctx,
			command.requestId && session.id
				? { sessionId: session.id, requestId: command.requestId, organization: session.factors.user.organizationId }
				: { loginName: session.factors.user.loginName, organization: session.factors.user.organizationId },
			loginSettings.defaultRedirectUri,
		);
	}

	static async registerUserAndLinkToIDP(
		ctx: LoginContext,
		command: {
			email: string;
			firstName: string;
			lastName: string;
			organization: string;
			requestId?: string;
			idpIntent: { idpIntentId: string; idpIntentToken: string };
			idpUserId: string;
			idpId: string;
			idpUserName: string;
		},
	): Promise<FlowResult> {
		const t = await ctx.t("register");
		const serviceConfig = ctx.serviceConfig;

		const loginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization: command.organization });

		if (!loginSettings) return { error: t("errors.couldNotGetLoginSettings") };
		if (!loginSettings.allowRegister) return { error: t("errors.registerNotAllowed") };

		const addUserResponse = await ZitadelAPI.addHumanUser({
			serviceConfig,
			email: command.email,
			firstName: command.firstName,
			lastName: command.lastName,
			organization: command.organization,
		});

		const idpLink = await ZitadelAPI.addIDPLink({
			serviceConfig,
			idp: { id: command.idpId, userId: command.idpUserId, userName: command.idpUserName },
			userId: addUserResponse.userId,
		});
		if (!idpLink) return { error: t("errors.couldNotLinkIDP") };

		const session = await LoginSessionCookie.createSessionForIdpAndUpdateCookie(ctx, {
			requestId: command.requestId,
			userId: addUserResponse.userId, // the user we just created
			idpIntent: command.idpIntent,
			lifetime: loginSettings.externalLoginCheckLifetime,
		});

		if (!session?.factors?.user) return { error: t("errors.couldNotCreateSession") };

		let authMethods: Awaited<ReturnType<typeof ZitadelAPI.listAuthenticationMethodTypes>>["authMethodTypes"] | undefined;
		if (session.factors.user.id) {
			const response = await ZitadelAPI.listAuthenticationMethodTypes({
				serviceConfig,
				userId: session.factors.user.id,
			});
			if (response.authMethodTypes?.length) authMethods = response.authMethodTypes;
		}

		// always check, so forced MFA is respected even without configured methods
		const mfaFactorCheck = await MFA.checkMFAFactors(
			serviceConfig,
			session,
			loginSettings,
			authMethods || [],
			command.organization,
			command.requestId,
		);
		if (mfaFactorCheck?.redirect) return mfaFactorCheck;

		return LoginFlow.completeFlowOrGetUrl(
			ctx,
			command.requestId && session.id
				? { sessionId: session.id, requestId: command.requestId, organization: session.factors.user.organizationId }
				: { loginName: session.factors.user.loginName, organization: session.factors.user.organizationId },
			loginSettings.defaultRedirectUri,
		);
	}
}
