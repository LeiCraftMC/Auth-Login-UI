/**
 * System-user JWT — the only way this login authenticates against Zitadel (virtual instances:
 * one system user serves every instance, the instance is picked per request by the
 * `x-zitadel-instance-host` header). A self-signed RS256 JWT (iss/sub = system user id,
 * aud = AUDIENCE, exp = now + 1h) is sent as `Authorization: Bearer <jwt>`.
 *
 * Same claims as `newSystemToken` of @zitadel/client (used by the Zitadel login), but the token is
 * cached and re-minted shortly before it expires instead of on every call. The pattern follows
 * LAVIAC's `ZitadelSystemJwt`. See:
 * https://zitadel.com/docs/guides/integrate/zitadel-apis/access-zitadel-system-api
 */
import { createPrivateKey } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";

const LIFETIME_SECONDS = 60 * 60; // Zitadel rejects exp further than 1h after iat.
const REFRESH_MARGIN_SECONDS = 5 * 60;

export class ZitadelSystemToken {
	private static cachedKey: CryptoKey | null = null;
	private static cachedToken: string | null = null;
	private static cachedExp = 0;

	/** jose's `importPKCS8` needs PKCS#8; `openssl genrsa -traditional` emits PKCS#1. */
	static normalizePrivateKeyPem(pem: string): string {
		if (pem.includes("BEGIN PRIVATE KEY")) return pem;
		return createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString();
	}

	private static async getKey(): Promise<CryptoKey> {
		if (ZitadelSystemToken.cachedKey) return ZitadelSystemToken.cachedKey;
		const pem = ZitadelSystemToken.normalizePrivateKeyPem(
			ConfigHandler.resolveSystemUserPrivateKey(),
		);
		ZitadelSystemToken.cachedKey = await importPKCS8(pem, "RS256");
		return ZitadelSystemToken.cachedKey;
	}

	/** Mint (or return the cached) system-user JWT. */
	static async get(): Promise<string> {
		const nowSeconds = Math.floor(Date.now() / 1000);

		if (
			ZitadelSystemToken.cachedToken &&
			ZitadelSystemToken.cachedExp - nowSeconds > REFRESH_MARGIN_SECONDS
		) {
			return ZitadelSystemToken.cachedToken;
		}

		const config = ConfigHandler.get();
		const key = await ZitadelSystemToken.getKey();
		const exp = nowSeconds + LIFETIME_SECONDS;

		ZitadelSystemToken.cachedToken = await new SignJWT({})
			.setProtectedHeader({ alg: "RS256" })
			.setIssuedAt(nowSeconds)
			.setExpirationTime(exp)
			.setIssuer(config.SYSTEM_USER_ID)
			.setSubject(config.SYSTEM_USER_ID)
			.setAudience(config.AUDIENCE)
			.sign(key);
		ZitadelSystemToken.cachedExp = exp;

		Logger.debug("Minted a new Zitadel system-user token.");
		return ZitadelSystemToken.cachedToken;
	}

	/** Drop the cached key and token (tests, key rotation). */
	static reset() {
		ZitadelSystemToken.cachedKey = null;
		ZitadelSystemToken.cachedToken = null;
		ZitadelSystemToken.cachedExp = 0;
	}
}
