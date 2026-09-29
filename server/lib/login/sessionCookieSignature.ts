/**
 * Signing of the `sessions` cookie entries (port of the Zitadel login's
 * `lib/session-cookie-signature.ts`, same algorithm and payload so cookies stay compatible).
 *
 * Every entry is signed with an HMAC-SHA256 over a canonical JSON payload using a key derived via
 * HKDF from `SESSION_COOKIE_SECRET` (comma-separated for rotation: the first signs, all verify).
 * Unsigned or tampered entries are ignored, so a client cannot patch an arbitrary session into
 * its cookie. Deprecated fallback: without a dedicated secret, the system-user credential is used.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { ConfigHandler } from "../utils/config";

const SIGNATURE_VERSION = "v1";
// Domain separation: the derived key is only ever used for session cookie signatures.
const HKDF_INFO = `zitadel-login-session-cookie-${SIGNATURE_VERSION}`;
const DERIVED_KEY_LENGTH = 32;

/** Minimum length of each SESSION_COOKIE_SECRET value. */
export const MIN_SESSION_COOKIE_SECRET_LENGTH = 32;

export type SignableSession = {
	id: string;
	token: string;
	sig?: string;
};

export class SessionCookieSignature {
	private static readonly derivedKeyCache = new Map<string, Buffer>();

	private static deriveKey(secret: string): Buffer {
		let key = SessionCookieSignature.derivedKeyCache.get(secret);
		if (!key) {
			key = Buffer.from(hkdfSync("sha256", secret, "", HKDF_INFO, DERIVED_KEY_LENGTH));
			SessionCookieSignature.derivedKeyCache.set(secret, key);
		}
		return key;
	}

	private static getDedicatedSecrets(): string[] {
		return ConfigHandler.getConfig()?.SESSION_COOKIE_SECRET ?? [];
	}

	private static getCredentialSecrets(): string[] {
		const credential = ConfigHandler.getConfig()
			? ConfigHandler.resolveCredentialSecret()
			: undefined;
		return credential ? [credential] : [];
	}

	/** An error message if SESSION_COOKIE_SECRET is set but not usable, otherwise undefined. */
	static getConfigError(): string | undefined {
		const tooShort = SessionCookieSignature.getDedicatedSecrets().filter(
			(s) => s.length < MIN_SESSION_COOKIE_SECRET_LENGTH,
		).length;
		if (tooShort > 0) {
			return (
				`SESSION_COOKIE_SECRET is invalid: every value must be at least ${MIN_SESSION_COOKIE_SECRET_LENGTH} characters long ` +
				`(${tooShort} value(s) are shorter). Generate one with \`openssl rand -base64 32\`.`
			);
		}
		return undefined;
	}

	/** All secrets that may sign/verify entries, in priority order (none if misconfigured). */
	static getSecrets(): string[] {
		if (SessionCookieSignature.getConfigError()) return [];
		return Array.from(
			new Set([
				...SessionCookieSignature.getDedicatedSecrets(),
				...SessionCookieSignature.getCredentialSecrets(),
			]),
		);
	}

	static isUsingCredentialFallback(): boolean {
		return (
			SessionCookieSignature.getDedicatedSecrets().length === 0 &&
			SessionCookieSignature.getCredentialSecrets().length > 0
		);
	}

	static hasSecret(): boolean {
		return SessionCookieSignature.getSecrets().length > 0;
	}

	/** Problems with the signing configuration, logged once at startup. */
	static getStartupNotice(): { level: "error" | "warn"; message: string } | undefined {
		const configError = SessionCookieSignature.getConfigError();
		if (configError) {
			return {
				level: "error",
				message: `${configError} The login cannot sign session cookies and reports not ready.`,
			};
		}
		if (!SessionCookieSignature.hasSecret()) {
			return {
				level: "error",
				message:
					"No session cookie signing secret available. Set SESSION_COOKIE_SECRET. The login reports not ready until a secret is configured.",
			};
		}
		if (SessionCookieSignature.isUsingCredentialFallback()) {
			return {
				level: "warn",
				message:
					"SESSION_COOKIE_SECRET is not set; the session cookie signing key is derived from the system user key. " +
					"Rotating that key signs all users out. Set SESSION_COOKIE_SECRET.",
			};
		}
		return undefined;
	}

	/**
	 * Canonical representation of an entry: all fields except `sig`, keys sorted, undefined values
	 * dropped (JSON.stringify omits them too, so `organization: undefined` equals a missing key).
	 */
	private static canonicalPayload(session: SignableSession): string {
		const { sig: _ignored, ...fields } = session;
		const sorted = Object.fromEntries(
			Object.keys(fields)
				.sort()
				.filter((key) => (fields as Record<string, unknown>)[key] !== undefined)
				.map((key) => [key, (fields as Record<string, unknown>)[key]]),
		);
		return JSON.stringify([SIGNATURE_VERSION, sorted]);
	}

	private static computeSignature(session: SignableSession, secret: string): string {
		return createHmac("sha256", SessionCookieSignature.deriveKey(secret))
			.update(SessionCookieSignature.canonicalPayload(session))
			.digest("base64url");
	}

	private static signaturesEqual(left: string, right: string): boolean {
		const leftBytes = Buffer.from(left);
		const rightBytes = Buffer.from(right);
		if (leftBytes.length !== rightBytes.length) return false;
		return timingSafeEqual(leftBytes, rightBytes);
	}

	static sign<T extends SignableSession>(session: T): T & { sig: string } {
		if (!session.id || !session.token) {
			throw new Error("Session cookie entries require a non-empty id and token to be signed.");
		}

		const [secret] = SessionCookieSignature.getSecrets();
		if (!secret) {
			throw new Error(
				SessionCookieSignature.getConfigError() ??
					"Session cookie signing secret is not configured. Set SESSION_COOKIE_SECRET (at least 32 characters, e.g. `openssl rand -base64 32`).",
			);
		}

		const { sig: _ignored, ...unsigned } = session;
		return { ...(unsigned as T), sig: SessionCookieSignature.computeSignature(unsigned, secret) };
	}

	static verify(session: unknown): session is SignableSession & { sig: string } {
		if (!session || typeof session !== "object") return false;

		const candidate = session as SignableSession;
		if (
			typeof candidate.id !== "string" ||
			!candidate.id ||
			typeof candidate.token !== "string" ||
			!candidate.token ||
			typeof candidate.sig !== "string" ||
			!candidate.sig
		) {
			return false;
		}

		const { sig, ...unsigned } = candidate;
		// Check every secret (no early return) so timing doesn't reveal which one matches.
		let valid = false;
		for (const secret of SessionCookieSignature.getSecrets()) {
			if (
				SessionCookieSignature.signaturesEqual(
					sig,
					SessionCookieSignature.computeSignature(unsigned, secret),
				)
			) {
				valid = true;
			}
		}
		return valid;
	}

	static strip<T extends SignableSession>(session: T): Omit<T, "sig"> {
		const { sig: _ignored, ...unsigned } = session;
		return unsigned;
	}

	/** Parses the cookie value and returns only the entries with a valid signature. */
	static parseAndVerify<T extends SignableSession>(value: string | undefined): T[] {
		if (!value) return [];
		try {
			const parsed = JSON.parse(value);
			if (!Array.isArray(parsed)) return [];
			return parsed
				.filter((entry) => SessionCookieSignature.verify(entry))
				.map((entry) => SessionCookieSignature.strip(entry as T) as T);
		} catch {
			return [];
		}
	}
}
