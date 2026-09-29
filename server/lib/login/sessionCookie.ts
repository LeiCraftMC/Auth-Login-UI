/**
 * Creating and updating Zitadel sessions together with their cookie entry (port of the Zitadel
 * login's `lib/server/cookie.ts`).
 */
import type { Duration } from "@bufbuild/protobuf/wkt";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { Logger } from "../utils/logger";
import { ZitadelAPI } from "../zitadel/api";
import { CredentialsCheckErrorSchema } from "../zitadel/proto/zitadel/message_pb";
import type { Challenges, RequestChallenges } from "../zitadel/proto/zitadel/session/v2/challenge_pb";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import type { Checks } from "../zitadel/proto/zitadel/session/v2/session_service_pb";
import type { LoginContext } from "./context";
import { type SessionCookie, SessionCookies } from "./cookies";
import { LoginSecurity } from "./security";
import { LoginUserAgent } from "./userAgent";

const DEFAULT_LIFETIME: Duration = { seconds: BigInt(24 * 60 * 60), nanos: 0 } as Duration;

/** Thrown when Zitadel rejects a password check; carries the failed attempt count. */
export type FailedAttemptsError = { error: string; failedAttempts: number };

export function isFailedAttemptsError(error: unknown): error is FailedAttemptsError {
	return !!error && typeof error === "object" && "failedAttempts" in error && !!(error as any).failedAttempts;
}

function passwordAttemptsHandler(error: unknown): never {
	if (error instanceof ConnectError) {
		const details = error.findDetails(CredentialsCheckErrorSchema);
		if (details[0] && "failedAttempts" in details[0]) {
			const failedAttempts = details[0].failedAttempts;
			throw {
				error: `Failed to authenticate: You had ${failedAttempts} password attempts.`,
				failedAttempts,
			} satisfies FailedAttemptsError;
		}
	}
	throw error;
}

function tsString(ts: Parameters<typeof timestampMs>[0] | undefined) {
	return ts ? `${timestampMs(ts)}` : "";
}

export type SessionWithChallenges = Session & { challenges: Challenges | undefined };

export class LoginSessionCookie {
	private static async iFrameEnabled(ctx: LoginContext) {
		const securitySettings = await ZitadelAPI.getSecuritySettings({ serviceConfig: ctx.serviceConfig });
		return !!securitySettings?.embeddedIframe?.enabled;
	}

	static async createSessionAndUpdateCookie(
		ctx: LoginContext,
		command: {
			checks: Checks;
			requestId: string | undefined;
			lifetime?: Duration;
			challenges?: RequestChallenges;
		},
	): Promise<{ session: Session; sessionCookie: SessionCookie; challenges?: Challenges }> {
		let lifetime = command.lifetime;
		if (!lifetime || !lifetime.seconds) {
			Logger.warn("No session lifetime provided, using default of 24 hours");
			lifetime = DEFAULT_LIFETIME; // e.g. user discovery
		}

		const createdSession = await ZitadelAPI.createSessionFromChecksAndChallenges({
			serviceConfig: ctx.serviceConfig,
			checks: command.checks,
			lifetime,
			challenges: LoginSecurity.sanitizeChallenges(command.challenges),
			userAgent: LoginUserAgent.forSession(ctx),
		});

		if (!createdSession) {
			throw new Error("Could not create session");
		}

		const response = await ZitadelAPI.getSession({
			serviceConfig: ctx.serviceConfig,
			sessionId: createdSession.sessionId,
			sessionToken: createdSession.sessionToken,
		});

		if (!response?.session?.factors?.user?.loginName) {
			throw new Error("could not get session or session does not have loginName");
		}

		const session = response.session;
		const sessionCookie: SessionCookie = {
			id: createdSession.sessionId,
			token: createdSession.sessionToken,
			creationTs: tsString(session.creationDate),
			expirationTs: tsString(session.expirationDate),
			changeTs: tsString(session.changeDate),
			loginName: session.factors?.user?.loginName ?? "",
		};

		if (command.requestId) sessionCookie.requestId = command.requestId;
		if (session.factors?.user?.organizationId) {
			sessionCookie.organization = session.factors.user.organizationId;
		}

		SessionCookies.add(ctx, {
			session: sessionCookie,
			iFrameEnabled: await LoginSessionCookie.iFrameEnabled(ctx),
		});

		return { session, sessionCookie, challenges: createdSession.challenges };
	}

	static async createSessionForIdpAndUpdateCookie(
		ctx: LoginContext,
		{
			userId,
			idpIntent,
			requestId,
			lifetime,
		}: {
			userId: string;
			idpIntent: { idpIntentId?: string; idpIntentToken?: string };
			requestId: string | undefined;
			lifetime?: Duration;
		},
	): Promise<Session> {
		let sessionLifetime = lifetime;
		if (!sessionLifetime || !sessionLifetime.seconds) {
			Logger.warn("No IDP session lifetime provided, using default of 24 hours");
			sessionLifetime = DEFAULT_LIFETIME;
		}

		const createdSession = await ZitadelAPI.createSessionForUserIdAndIdpIntent({
			serviceConfig: ctx.serviceConfig,
			userId,
			idpIntent,
			lifetime: sessionLifetime,
			userAgent: LoginUserAgent.forSession(ctx),
		}).catch((error) => {
			Logger.error("Could not set session", error);
			if (isFailedAttemptsError(error)) {
				throw {
					error: `Failed to authenticate: You had ${error.failedAttempts} password attempts.`,
					failedAttempts: error.failedAttempts,
				} satisfies FailedAttemptsError;
			}
			throw error;
		});

		if (!createdSession) {
			throw new Error("Could not create session");
		}

		const { session } = await ZitadelAPI.getSession({
			serviceConfig: ctx.serviceConfig,
			sessionId: createdSession.sessionId,
			sessionToken: createdSession.sessionToken,
		});

		if (!session?.factors?.user?.loginName) {
			throw new Error("Could not retrieve session");
		}

		const sessionCookie: SessionCookie = {
			id: createdSession.sessionId,
			token: createdSession.sessionToken,
			creationTs: tsString(session.creationDate),
			expirationTs: tsString(session.expirationDate),
			changeTs: tsString(session.changeDate),
			loginName: session.factors.user.loginName ?? "",
			organization: session.factors.user.organizationId ?? "",
		};

		if (requestId) sessionCookie.requestId = requestId;
		if (session.factors.user.organizationId) {
			sessionCookie.organization = session.factors.user.organizationId;
		}

		SessionCookies.add(ctx, {
			session: sessionCookie,
			iFrameEnabled: await LoginSessionCookie.iFrameEnabled(ctx),
		});
		return session;
	}

	static async setSessionAndUpdateCookie(
		ctx: LoginContext,
		command: {
			recentCookie: SessionCookie;
			checks?: Checks;
			challenges?: RequestChallenges;
			requestId?: string;
			lifetime: Duration;
		},
	): Promise<SessionWithChallenges> {
		try {
			const updatedSession = await ZitadelAPI.setSession({
				serviceConfig: ctx.serviceConfig,
				sessionId: command.recentCookie.id,
				sessionToken: command.recentCookie.token,
				challenges: LoginSecurity.sanitizeChallenges(command.challenges),
				checks: command.checks,
				lifetime: command.lifetime,
			});

			if (!updatedSession) {
				throw new Error("Session could not be set");
			}

			const changeTs = tsString(updatedSession.details?.changeDate);
			const requestId = command.requestId;

			const response = await ZitadelAPI.getSession({
				serviceConfig: ctx.serviceConfig,
				sessionId: command.recentCookie.id,
				sessionToken: updatedSession.sessionToken,
			});

			if (!response?.session?.factors?.user?.loginName) {
				throw new Error("could not get session or session does not have loginName");
			}

			const { session } = response;
			const newCookie: SessionCookie = {
				id: command.recentCookie.id,
				token: updatedSession.sessionToken,
				creationTs: command.recentCookie.creationTs,
				expirationTs: command.recentCookie.expirationTs,
				// just overwrite the changeDate with the new one
				changeTs,
				loginName: session.factors?.user?.loginName ?? "",
				organization: session.factors?.user?.organizationId ?? "",
			};

			if (requestId) newCookie.requestId = requestId;

			SessionCookies.update(ctx, {
				id: newCookie.id,
				session: newCookie,
				iFrameEnabled: await LoginSessionCookie.iFrameEnabled(ctx),
			});

			return { ...session, challenges: updatedSession.challenges } as SessionWithChallenges;
		} catch (error) {
			return passwordAttemptsHandler(error);
		}
	}
}
