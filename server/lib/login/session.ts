/**
 * Session validity (port of the Zitadel login's `lib/session.ts`).
 */

import { type Timestamp, timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { type ServiceConfig, ZitadelAPI } from "../zitadel/api";
import type { AuthRequest } from "../zitadel/proto/zitadel/oidc/v2/authorization_pb";
import type { SAMLRequest } from "../zitadel/proto/zitadel/saml/v2/authorization_pb";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import { AuthenticationMethodType } from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import type { LoginContext } from "./context";
import { SessionCookies } from "./cookies";
import { MFA } from "./mfa";

export class LoginSessions {
	/** The Zitadel session behind the most recent cookie entry (optionally by loginName/org). */
	static async loadMostRecent(
		ctx: LoginContext,
		sessionParams: { loginName?: string; organization?: string },
	): Promise<Session | undefined> {
		const recent = SessionCookies.getMostRecentWithLoginName(ctx, sessionParams);
		if (!recent) return undefined;

		try {
			const resp = await ZitadelAPI.getSession({
				serviceConfig: ctx.serviceConfig,
				sessionId: recent.id,
				sessionToken: recent.token,
			});
			return resp.session;
		} catch (error) {
			// The cookie has no maxAge, so it can outlive the server-side session (logout,
			// terminated session, removed user/org/instance). Treat `not_found` like no cookie.
			if (error instanceof ConnectError && error.code === Code.NotFound) {
				Logger.warn("[Session] Could not load most recent session", error.message);
				return undefined;
			}
			throw error;
		}
	}

	/** The Zitadel session of a specific cookie entry, or undefined without a matching cookie. */
	static async loadById(ctx: LoginContext, sessionId: string, organization?: string) {
		const recent = SessionCookies.getById(ctx, { sessionId, organization });
		if (!recent) return undefined;

		const resp = await ZitadelAPI.getSession({
			serviceConfig: ctx.serviceConfig,
			sessionId: recent.id,
			sessionToken: recent.token,
		});
		return resp.session ?? undefined;
	}

	/**
	 * A session proves genuine (primary) authentication when password, a user-verified passkey
	 * (not a presence-only U2F assertion) or an IdP intent was verified and it has not expired.
	 * Gate for credential enrollment and the MFA setup page (GHSA-45f2-5q3r-xgg6).
	 */
	static hasVerifiedPrimaryFactor(session: Partial<Session>): {
		valid: boolean;
		verifiedAt?: Timestamp;
	} {
		const validPassword = session?.factors?.password?.verifiedAt;
		const validPasskey =
			session?.factors?.webAuthN?.verifiedAt && session?.factors?.webAuthN?.userVerified
				? session?.factors?.webAuthN?.verifiedAt
				: undefined;
		const validIDP = session?.factors?.intent?.verifiedAt;

		const stillValid = session.expirationDate
			? timestampDate(session.expirationDate) > new Date()
			: true;

		const verifiedAt = validPassword || validPasskey || validIDP;
		return { valid: !!(verifiedAt && stillValid), verifiedAt };
	}

	/** Whether the session can complete a login (primary factor, MFA, expiry, email). */
	static async isSessionValid({
		serviceConfig,
		session,
	}: {
		serviceConfig: ServiceConfig;
		session: Session;
	}): Promise<boolean> {
		// session can't be checked without user
		if (!session.factors?.user) return false;

		let mfaValid = true;

		const validIDP = session?.factors?.intent?.verifiedAt;
		const validPassword = session?.factors?.password?.verifiedAt;
		const validPasskey = session?.factors?.webAuthN?.verifiedAt;

		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: session.factors?.user?.organizationId,
		});

		const isMfaRequired = MFA.shouldEnforceMFA(session, loginSettings);

		const authMethodTypes = await ZitadelAPI.listAuthenticationMethodTypes({
			serviceConfig,
			userId: session.factors.user.id,
		});

		const mfaMethods = authMethodTypes.authMethodTypes?.filter(
			(method) =>
				method === AuthenticationMethodType.TOTP ||
				method === AuthenticationMethodType.OTP_EMAIL ||
				method === AuthenticationMethodType.OTP_SMS ||
				method === AuthenticationMethodType.U2F,
		);

		// A user-verified passkey is inherently multi-factor (mirrors checkMFAFactors).
		const hasAuthenticatedWithPasskey =
			!!session.factors.webAuthN?.verifiedAt && !!session.factors.webAuthN?.userVerified;

		if (mfaMethods && mfaMethods.length > 0) {
			// Configured MFA methods must be verified regardless of policy.
			const totpValid =
				mfaMethods.includes(AuthenticationMethodType.TOTP) && !!session.factors.totp?.verifiedAt;
			const otpEmailValid =
				mfaMethods.includes(AuthenticationMethodType.OTP_EMAIL) &&
				!!session.factors.otpEmail?.verifiedAt;
			const otpSmsValid =
				mfaMethods.includes(AuthenticationMethodType.OTP_SMS) && !!session.factors.otpSms?.verifiedAt;
			const u2fValid =
				mfaMethods.includes(AuthenticationMethodType.U2F) && !!session.factors.webAuthN?.verifiedAt;

			mfaValid = hasAuthenticatedWithPasskey || totpValid || otpEmailValid || otpSmsValid || u2fValid;
		} else if (isMfaRequired) {
			// No MFA methods configured, but MFA is forced by policy.
			mfaValid = !!(
				session.factors.otpEmail?.verifiedAt ||
				session.factors.otpSms?.verifiedAt ||
				session.factors.totp?.verifiedAt ||
				session.factors.webAuthN?.verifiedAt
			);
		}

		const stillValid = session.expirationDate
			? timestampDate(session.expirationDate).getTime() > Date.now()
			: true;

		if (!stillValid) {
			Logger.warn("[Session] Session is expired");
			return false;
		}

		if (!(validPassword || validPasskey || validIDP)) return false;

		if (!mfaValid) {
			Logger.warn("[Session] MFA is required but not valid");
			return false;
		}

		if (ConfigHandler.getConfig()?.EMAIL_VERIFICATION) {
			const userResponse = await ZitadelAPI.getUserByID({
				serviceConfig,
				userId: session.factors.user.id,
			});
			const humanUser =
				userResponse?.user?.type.case === "human" ? userResponse.user.type.value : undefined;
			if (humanUser && !humanUser.email?.isVerified) {
				Logger.warn("[Session] Email is not verified");
				return false;
			}
		}

		return true;
	}

	/** The newest valid session matching the request's hints (and organization). */
	static async findValidSession({
		serviceConfig,
		sessions,
		authRequest,
		samlRequest,
		organization,
	}: {
		serviceConfig: ServiceConfig;
		sessions: Session[];
		authRequest?: AuthRequest;
		samlRequest?: SAMLRequest;
		organization?: string;
	}): Promise<Session | undefined> {
		let sessionsWithHint = sessions.filter((s) => {
			if (authRequest?.hintUserId) return s.factors?.user?.id === authRequest.hintUserId;
			if (authRequest?.loginHint) return s.factors?.user?.loginName === authRequest.loginHint;
			// SAML requests carry no user hints
			void samlRequest;
			return true;
		});

		if (organization) {
			sessionsWithHint = sessionsWithHint.filter(
				(s) => s.factors?.user?.organizationId === organization,
			);
		}

		if (sessionsWithHint.length === 0) return undefined;

		sessionsWithHint.sort((a, b) => {
			const dateA = a.changeDate ? timestampDate(a.changeDate).getTime() : 0;
			const dateB = b.changeDate ? timestampDate(b.changeDate).getTime() : 0;
			return dateB - dateA;
		});

		for (const session of sessionsWithHint) {
			if (await LoginSessions.isSessionValid({ serviceConfig, session })) {
				return session;
			}
		}
		return undefined;
	}

	/** Live Zitadel sessions for the cookie entries (ignoring empty ids). */
	static async listFromCookies(ctx: LoginContext, ids: string[]): Promise<Session[]> {
		const filtered = ids.filter((id) => !!id);
		if (!filtered.length) return [];
		const response = await ZitadelAPI.listSessions({
			serviceConfig: ctx.serviceConfig,
			ids: filtered,
		});
		return response?.sessions ?? [];
	}
}
