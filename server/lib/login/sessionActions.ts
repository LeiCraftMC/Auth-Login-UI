/**
 * Session actions (port of the Zitadel login's `lib/server/session.ts`): request challenges /
 * submit checks on a session, continue with an existing session, skip the MFA setup, end a session.
 */
import { create } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { Logger } from "../utils/logger";
import { ZitadelAPI } from "../zitadel/api";
import { isClassifiedError } from "../zitadel/errors";
import type {
	Challenges,
	RequestChallenges,
} from "../zitadel/proto/zitadel/session/v2/challenge_pb";
import type { Factors, Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import {
	type Checks,
	ChecksSchema,
	CheckUserSchema,
} from "../zitadel/proto/zitadel/session/v2/session_service_pb";
import type { AuthenticationMethodType } from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import type { LoginContext } from "./context";
import { type SessionCookie, SessionCookies } from "./cookies";
import { LoginFlow } from "./flow";
import { LoginName } from "./loginname";
import { LoginSessions } from "./session";
import { LoginSessionCookie, type SessionWithChallenges } from "./sessionCookie";
import type { FlowResult } from "./types";

const DEFAULT_LIFETIME = { seconds: BigInt(60 * 60 * 24), nanos: 0 } as Duration;

export type UpdateSessionResult =
	| { error: string }
	| {
			sessionId: string;
			factors: Factors | undefined;
			challenges: Pick<Challenges, "webAuthN"> | undefined;
			authMethods: AuthenticationMethodType[] | undefined;
	  };

export class LoginSessionActions {
	static async skipMFAAndContinueWithNextUrl(
		ctx: LoginContext,
		{
			userId,
			requestId,
			loginName,
			sessionId,
			organization,
		}: {
			userId: string;
			loginName?: string;
			sessionId?: string;
			requestId?: string;
			organization?: string;
		},
	): Promise<FlowResult> {
		const serviceConfig = ctx.serviceConfig;
		const loginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization });

		await ZitadelAPI.humanMFAInitSkipped({ serviceConfig, userId });

		if (requestId && sessionId) {
			return LoginFlow.completeFlowOrGetUrl(
				ctx,
				{ sessionId, requestId, organization },
				loginSettings?.defaultRedirectUri,
			);
		}
		if (loginName) {
			return LoginFlow.completeFlowOrGetUrl(
				ctx,
				{ loginName, organization },
				loginSettings?.defaultRedirectUri,
			);
		}
		return { error: "Could not skip MFA and continue" };
	}

	/**
	 * Continues the login with an existing session of the account list. Unlike the Zitadel login
	 * (which receives the session object from the browser), the session is loaded server-side from
	 * the cookie — the decision is the same, but it cannot be influenced by the client.
	 */
	static async continueWithSession(
		ctx: LoginContext,
		{ sessionId, requestId }: { sessionId: string; requestId?: string },
	): Promise<FlowResult> {
		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("error");

		const session = await LoginSessions.loadById(ctx, sessionId).catch(() => undefined);

		if (!session?.factors?.user) {
			return { error: t("couldNotContinueSession") };
		}

		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: session.factors.user.organizationId,
		});

		// validate the session (incl. MFA) before completing the flow
		const valid = await LoginSessions.isSessionValid({ serviceConfig, session });

		if (!valid) {
			Logger.warn(
				"continueWithSession: session is not valid (e.g. MFA not completed), re-authenticating",
				{
					sessionId: session.id,
				},
			);

			// routes to the MFA page if the password is still valid
			const res = await LoginName.sendLoginname(ctx, {
				loginName: session.factors.user.loginName,
				organization: session.factors.user.organizationId,
				requestId,
			});
			if (res && "redirect" in res && res.redirect) return { redirect: res.redirect };
			if (res && "samlData" in res && res.samlData) return { samlData: res.samlData };
			return { error: t("couldNotContinueSession") };
		}

		if (requestId && session.id) {
			return LoginFlow.completeFlowOrGetUrl(
				ctx,
				{ sessionId: session.id, requestId, organization: session.factors.user.organizationId },
				loginSettings?.defaultRedirectUri,
			);
		}

		return LoginFlow.completeFlowOrGetUrl(
			ctx,
			{ loginName: session.factors.user.loginName, organization: session.factors.user.organizationId },
			loginSettings?.defaultRedirectUri,
		);
	}

	/**
	 * Requests challenges (WebAuthn, OTP) and/or submits checks on the session of the cookie
	 * (by id, by loginName or the most recent one), creating a session if there is none.
	 */
	static async updateOrCreateSession(
		ctx: LoginContext,
		options: {
			loginName?: string;
			sessionId?: string;
			organization?: string;
			checks?: Checks;
			requestId?: string;
			challenges?: RequestChallenges;
			lifetime?: Duration;
		},
	): Promise<UpdateSessionResult> {
		const { loginName, sessionId, organization, checks, requestId, challenges } = options;
		let { lifetime } = options;

		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("verify.errors");

		let host: string;
		try {
			host = ctx.publicHost();
		} catch {
			return { error: "Could not get host" };
		}

		if (challenges?.webAuthN && !challenges.webAuthN.domain) {
			const [hostname] = host.split(":");
			challenges.webAuthN.domain = hostname ?? "";
		}

		let recentSession: SessionCookie | undefined = sessionId
			? SessionCookies.getById(ctx, { sessionId })
			: loginName
				? SessionCookies.getByLoginName(ctx, { loginName, organization })
				: SessionCookies.getMostRecent(ctx);

		if (!recentSession) {
			if (!loginName) {
				return { error: t("couldNotFindSession") };
			}

			const result = await LoginSessionCookie.createSessionAndUpdateCookie(ctx, {
				checks: create(ChecksSchema, { user: { search: { case: "loginName", value: loginName } } }),
				challenges,
				requestId,
			}).catch((error) => {
				if (isClassifiedError(error) && error.isUserError) {
					Logger.warn("Could not create session (client error)", { grpcCode: error.code });
				} else {
					Logger.error("Could not create session (server error)", error);
				}
				return undefined;
			});

			recentSession = result?.sessionCookie;
			if (!recentSession) {
				return { error: t("couldNotFindSession") };
			}
		}

		const loginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization });

		if (!lifetime) {
			lifetime = checks?.webAuthN
				? loginSettings?.multiFactorCheckLifetime // TODO different lifetime for webauthn u2f/passkey
				: checks?.otpEmail || checks?.otpSms
					? loginSettings?.secondFactorCheckLifetime
					: undefined;
		}

		if (!lifetime?.seconds) {
			Logger.warn("No lifetime provided for session, defaulting to 24 hours");
			lifetime = DEFAULT_LIFETIME;
		}

		let session: SessionWithChallenges | undefined;
		try {
			session = await LoginSessionCookie.setSessionAndUpdateCookie(ctx, {
				recentCookie: recentSession,
				checks,
				challenges,
				requestId,
				lifetime,
			});
		} catch (error) {
			const loginNameForCreation = options.loginName || recentSession?.loginName;
			const orgForCreation = options.organization || recentSession?.organization;

			if (!loginNameForCreation) throw error;

			const users = await ZitadelAPI.listUsers({
				serviceConfig,
				loginName: loginNameForCreation,
				organizationId: orgForCreation,
			});

			const user = users.details?.totalResult === BigInt(1) ? users.result[0] : undefined;
			if (!user?.userId) throw error;

			const result = await LoginSessionCookie.createSessionAndUpdateCookie(ctx, {
				checks: {
					...(checks ?? create(ChecksSchema)),
					user: create(CheckUserSchema, { search: { case: "userId", value: user.userId } }),
				},
				requestId,
				lifetime,
				challenges,
			});
			session = { ...result.session, challenges: result.challenges } as SessionWithChallenges;
		}

		if (!session) {
			return { error: t("couldNotUpdateSession") };
		}

		// after a password check, tell the client the user's auth methods
		let authMethods: AuthenticationMethodType[] | undefined;
		if (checks?.password && session.factors?.user?.id) {
			const response = await ZitadelAPI.listAuthenticationMethodTypes({
				serviceConfig,
				userId: session.factors.user.id,
			});
			if (response.authMethodTypes?.length) authMethods = response.authMethodTypes;
		}

		const challengeResponse: Challenges | undefined = session.challenges;

		return {
			sessionId: session.id,
			factors: session.factors,
			// Only the WebAuthN challenge may reach the browser; no OTP code can leak through this
			// boundary even if sanitizing ever regresses (GHSA-3gwm-5wx8-4gm6).
			challenges: challengeResponse?.webAuthN ? { webAuthN: challengeResponse.webAuthN } : undefined,
			authMethods,
		};
	}

	/** Deletes the session in Zitadel and removes it from the cookie. */
	static async clearSession(
		ctx: LoginContext,
		{ sessionId }: { sessionId: string },
	): Promise<{ error?: string }> {
		const serviceConfig = ctx.serviceConfig;

		const sessionCookie = SessionCookies.getById(ctx, { sessionId });
		if (!sessionCookie) return {};

		try {
			const deleted = await ZitadelAPI.deleteSession({
				serviceConfig,
				sessionId: sessionCookie.id,
				sessionToken: sessionCookie.token,
			});
			if (!deleted) throw new Error("Could not delete session");
		} catch (error) {
			// PermissionDenied: the session no longer exists (or the cookie token is stale); the user
			// asked to remove the account, so the entry is pruned anyway. Other failures keep it.
			if (!isClassifiedError(error) || error.code !== Code.PermissionDenied) {
				Logger.error("clearSession: could not delete session", { sessionId: sessionCookie.id, error });
				const t = await ctx.t("error");
				return { error: t("couldNotClearSession") };
			}
			Logger.warn(
				"clearSession: session rejected the cookie token (gone or stale), pruning cookie entry",
				{
					sessionId: sessionCookie.id,
				},
			);
		}

		const securitySettings = await ZitadelAPI.getSecuritySettings({ serviceConfig });
		SessionCookies.remove(ctx, {
			session: sessionCookie,
			iFrameEnabled: !!securitySettings?.embeddedIframe?.enabled,
		});
		return {};
	}
}

export type { Session };
