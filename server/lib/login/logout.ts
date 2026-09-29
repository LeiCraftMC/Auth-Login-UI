/**
 * Logout and device authorization helpers (Zitadel login: the logout page's `verifyJwt` and
 * `lib/server/device.ts`).
 */
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import { Logger } from "../utils/logger";
import { type ServiceConfig, ZitadelAPI } from "../zitadel/api";

type RemoteJWKSet = ReturnType<typeof createRemoteJWKSet>;

export class LoginLogout {
	private static readonly jwks = new Map<string, RemoteJWKSet>();

	private static keySet(serviceConfig: ServiceConfig): RemoteJWKSet {
		const key = `${serviceConfig.baseUrl}|${serviceConfig.instanceHost ?? ""}|${serviceConfig.publicHost ?? ""}`;
		let set = LoginLogout.jwks.get(key);
		if (!set) {
			const headers: Record<string, string> = {};
			if (serviceConfig.instanceHost) headers["x-zitadel-instance-host"] = serviceConfig.instanceHost;
			if (serviceConfig.publicHost) headers["x-zitadel-public-host"] = serviceConfig.publicHost;
			set = createRemoteJWKSet(new URL(`${serviceConfig.baseUrl}/oauth/v2/keys`), { headers });
			LoginLogout.jwks.set(key, set);
		}
		return set;
	}

	/**
	 * Reads `post_logout_redirect_uri` and `logout_hint` from the `logout_token` Zitadel passes to
	 * the logout page, after verifying its signature with the instance's keys.
	 */
	static async verifyLogoutToken(
		serviceConfig: ServiceConfig,
		logoutToken: string,
	): Promise<{ postLogoutRedirectUri?: string; logoutHint?: string }> {
		try {
			const { payload } = await jwtVerify<JWTPayload & Record<string, unknown>>(
				logoutToken,
				LoginLogout.keySet(serviceConfig),
			);
			return {
				postLogoutRedirectUri:
					typeof payload.post_logout_redirect_uri === "string"
						? payload.post_logout_redirect_uri
						: undefined,
				logoutHint: typeof payload.logout_hint === "string" ? payload.logout_hint : undefined,
			};
		} catch (error) {
			Logger.error("Failed to verify logout token", error);
			return {};
		}
	}

	/** Approves (with a session) or denies (without) a device authorization request. */
	static completeDeviceAuthorization(
		serviceConfig: ServiceConfig,
		deviceAuthorizationId: string,
		session?: { sessionId: string; sessionToken: string },
	) {
		return ZitadelAPI.authorizeOrDenyDeviceAuthorization({
			serviceConfig,
			deviceAuthorizationId,
			session,
		});
	}
}
