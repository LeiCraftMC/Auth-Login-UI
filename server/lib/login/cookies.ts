/**
 * Login cookies (port of the Zitadel login's `lib/cookies.ts` + `lib/fingerprint.ts`). Names and
 * formats are identical to the Zitadel login so both can share a domain or replace each other:
 *
 * - `sessions`          — httpOnly JSON array of signed session entries (id + token + metadata)
 * - `NEXT_LOCALE`       — selected language
 * - `fingerprintId`     — random browser id (user agent fingerprint, IdP link binding)
 * - `verificationCheck` — 5-minute proof that the user just verified their email / invite code
 */
import { createHash, randomUUID } from "node:crypto";
import { I18n } from "../i18n";
import { Logger } from "../utils/logger";
import type { LoginContext } from "./context";
import { SessionCookieSignature } from "./sessionCookieSignature";

// Browsers cap a cookie at ~4096 bytes (name, value and attributes); keep a margin for the
// attributes and the signature added to every entry.
const MAX_COOKIE_SIZE = 3500;

const SESSIONS_COOKIE = "sessions";
const FINGERPRINT_COOKIE = "fingerprintId";
const VERIFICATION_CHECK_COOKIE = "verificationCheck";

export type SessionCookie = {
	id: string;
	token: string;
	loginName: string;
	organization?: string;
	creationTs: string;
	expirationTs: string;
	changeTs: string;
	/** Set if the session is linked to an OIDC/SAML/device request. */
	requestId?: string;
};

function isNotExpired(session: SessionCookie, now = new Date()) {
	return session.expirationTs ? new Date(Number(session.expirationTs)) > now : true;
}

function mostRecent(sessions: SessionCookie[]) {
	return sessions.reduce((prev, current) => (prev.changeTs > current.changeTs ? prev : current));
}

export class SessionCookies {
	private static read(ctx: LoginContext): SessionCookie[] {
		const value = ctx.getCookie(SESSIONS_COOKIE);
		const sessions = SessionCookieSignature.parseAndVerify<SessionCookie>(value);

		if (value) {
			let entries = 0;
			try {
				const parsed = JSON.parse(value);
				entries = Array.isArray(parsed) ? parsed.length : 0;
			} catch {
				entries = 0;
			}
			if (sessions.length < entries) {
				Logger.warn(
					`Ignoring ${entries - sessions.length} session cookie entries with a missing or invalid signature (unsigned legacy cookie or signing secret changed).`,
				);
			}
		}
		return sessions;
	}

	private static write(ctx: LoginContext, sessions: SessionCookie[], iFrameEnabled = false) {
		// "none" is required for iframe embedding and is only accepted together with "secure".
		const sameSite = iFrameEnabled ? "None" : "Lax";
		ctx.setCookie(
			SESSIONS_COOKIE,
			JSON.stringify(sessions.map((session) => SessionCookieSignature.sign(session))),
			{
				httpOnly: true,
				path: "/",
				sameSite,
				secure: process.env.NODE_ENV === "production" || sameSite === "None",
			},
		);
	}

	static add(
		ctx: LoginContext,
		{ session, cleanup, iFrameEnabled }: { session: SessionCookie; cleanup?: boolean; iFrameEnabled?: boolean },
	) {
		let current = SessionCookies.read(ctx);

		const index = current.findIndex((s) => s.loginName === session.loginName);
		if (index > -1) {
			current[index] = session;
		} else {
			const candidate = [...current, session];
			// measure the value as it will be written (including signatures)
			if (
				JSON.stringify(candidate.map((s) => SessionCookieSignature.sign(s))).length >= MAX_COOKIE_SIZE
			) {
				Logger.warn("Session cookie overflow, replacing the oldest session.");
				current = [session].concat(current.slice(1));
			} else {
				current = [session].concat(current);
			}
		}

		SessionCookies.write(ctx, cleanup ? current.filter((s) => isNotExpired(s)) : current, iFrameEnabled);
	}

	static update(
		ctx: LoginContext,
		{
			id,
			session,
			cleanup,
			iFrameEnabled,
		}: { id: string; session: SessionCookie; cleanup?: boolean; iFrameEnabled?: boolean },
	) {
		const hasCookie = !!ctx.getCookie(SESSIONS_COOKIE);
		const sessions = hasCookie ? SessionCookies.read(ctx) : [session];

		const index = sessions.findIndex((s) => s.id === id);
		if (index === -1) {
			throw new Error("updateSessionCookie: session id not found");
		}
		sessions[index] = session;
		SessionCookies.write(ctx, cleanup ? sessions.filter((s) => isNotExpired(s)) : sessions, iFrameEnabled);
	}

	static remove(
		ctx: LoginContext,
		{ session, cleanup, iFrameEnabled }: { session: SessionCookie; cleanup?: boolean; iFrameEnabled?: boolean },
	) {
		const hasCookie = !!ctx.getCookie(SESSIONS_COOKIE);
		const sessions = hasCookie ? SessionCookies.read(ctx) : [session];
		const reduced = sessions.filter((s) => s.id !== session.id);
		SessionCookies.write(ctx, cleanup ? reduced.filter((s) => isNotExpired(s)) : reduced, iFrameEnabled);
	}

	static getMostRecent(ctx: LoginContext): SessionCookie | undefined {
		const sessions = SessionCookies.read(ctx);
		return sessions.length ? mostRecent(sessions) : undefined;
	}

	static getById(
		ctx: LoginContext,
		{ sessionId, organization }: { sessionId: string; organization?: string },
	): SessionCookie | undefined {
		return SessionCookies.read(ctx).find((s) =>
			organization ? s.organization === organization && s.id === sessionId : s.id === sessionId,
		);
	}

	static getByLoginName(
		ctx: LoginContext,
		{ loginName, organization }: { loginName?: string; organization?: string },
	): SessionCookie | undefined {
		return SessionCookies.read(ctx).find((s) =>
			organization ? s.organization === organization && s.loginName === loginName : s.loginName === loginName,
		);
	}

	/** @param cleanup exclude expired entries (default false) */
	static getAll(ctx: LoginContext, cleanup = false): SessionCookie[] {
		const sessions = SessionCookies.read(ctx);
		return cleanup ? sessions.filter((s) => isNotExpired(s)) : sessions;
	}

	static getAllIds(ctx: LoginContext, cleanup = false): string[] {
		return SessionCookies.getAll(ctx, cleanup).map(({ id }) => id);
	}

	/** Most recent entry, optionally filtered by loginName and organization. */
	static getMostRecentWithLoginName(
		ctx: LoginContext,
		{ loginName, organization }: { loginName?: string; organization?: string },
	): SessionCookie | undefined {
		let filtered = SessionCookies.read(ctx);
		if (loginName) filtered = filtered.filter((c) => c.loginName === loginName);
		if (organization) filtered = filtered.filter((c) => c.organization === organization);
		return filtered.length ? mostRecent(filtered) : undefined;
	}
}

export class LoginCookies {
	static setLanguage(ctx: LoginContext, language: string) {
		ctx.setCookie(I18n.LANGUAGE_COOKIE_NAME, language, { httpOnly: true, path: "/" });
	}

	static getLanguage(ctx: LoginContext): string | undefined {
		return ctx.getCookie(I18n.LANGUAGE_COOKIE_NAME);
	}

	static getFingerprintId(ctx: LoginContext): string | undefined {
		return ctx.getCookie(FINGERPRINT_COOKIE) || undefined;
	}

	static getOrSetFingerprintId(ctx: LoginContext): string {
		const existing = LoginCookies.getFingerprintId(ctx);
		if (existing) return existing;

		const fingerprintId = randomUUID();
		ctx.setCookie(FINGERPRINT_COOKIE, fingerprintId, {
			httpOnly: true,
			path: "/",
			maxAge: 31536000, // 1 year
		});
		return fingerprintId;
	}

	/**
	 * Marks that `userId` just verified their email / invite code in this browser (hash of user id
	 * and fingerprint, 5 minutes). Allows setting up a first authenticator without a session.
	 */
	static setVerificationCheck(ctx: LoginContext, userId: string) {
		const fingerprintId = LoginCookies.getOrSetFingerprintId(ctx);
		const verificationCheck = createHash("sha256").update(`${userId}:${fingerprintId}`).digest("hex");
		ctx.setCookie(VERIFICATION_CHECK_COOKIE, verificationCheck, {
			httpOnly: true,
			path: "/",
			maxAge: 300,
		});
	}

	/** Whether a user verification for `userId` was done earlier in this browser. */
	static checkUserVerification(ctx: LoginContext, userId: string): boolean {
		const fingerprintId = LoginCookies.getFingerprintId(ctx);
		if (!fingerprintId) return false;

		const expected = createHash("sha256").update(`${userId}:${fingerprintId}`).digest("hex");
		const actual = ctx.getCookie(VERIFICATION_CHECK_COOKIE);

		if (!actual) {
			Logger.warn("User verification check cookie not found. User verification check failed.");
			return false;
		}
		if (actual !== expected) {
			Logger.warn("User verification check failed.");
			return false;
		}
		return true;
	}
}
