import { afterEach, describe, expect, test } from "bun:test";
import { ProtocolRoutes } from "../server/lib/protocol";
import { ConfigHandler } from "../server/lib/utils/config";
import { OIDCService } from "../server/lib/zitadel/proto/zitadel/oidc/v2/oidc_service_pb";
import { TEST_PUBLIC_HOST } from "./helpers/preload";
import { defaultInstanceRoutes, mockZitadel, resetZitadelMock } from "./helpers/zitadel";

const BASE = "/ui/v2/login";

function request(path: string, headers: Record<string, string> = {}) {
	return ProtocolRoutes.getApp().request(`${BASE}${path}`, {
		headers: { host: TEST_PUBLIC_HOST, ...headers },
		redirect: "manual",
	});
}

afterEach(() => {
	resetZitadelMock();
});

describe("GET /login (flow initiation)", () => {
	test("starts an OIDC request at the login-name page and applies ui_locales", async () => {
		mockZitadel((router) => {
			defaultInstanceRoutes(router);
			router.service(OIDCService, {
				getAuthRequest: ({ authRequestId }) => ({
					authRequest: { id: authRequestId, scope: ["openid"], uiLocales: ["de-CH"], prompt: [] },
				}),
			});
		});

		const res = await request("/login?authRequest=V2_123");

		expect(res.status).toBe(307);
		const location = new URL(res.headers.get("location") ?? "");
		expect(location.host).toBe(TEST_PUBLIC_HOST);
		expect(location.pathname).toBe(`${BASE}/loginname`);
		expect(location.searchParams.get("requestId")).toBe("oidc_V2_123");
		expect(res.headers.getSetCookie().some((c) => c.startsWith("NEXT_LOCALE=de"))).toBe(true);
	});

	test("passes the organization scope on", async () => {
		mockZitadel((router) => {
			defaultInstanceRoutes(router);
			router.service(OIDCService, {
				getAuthRequest: ({ authRequestId }) => ({
					authRequest: {
						id: authRequestId,
						scope: ["openid", "urn:zitadel:iam:org:id:284614553271599104"],
						prompt: [],
					},
				}),
			});
		});

		const res = await request("/login?authRequest=V2_123");
		const location = new URL(res.headers.get("location") ?? "");
		expect(location.searchParams.get("organization")).toBe("284614553271599104");
	});

	test("rejects requests without a valid auth request", async () => {
		mockZitadel((router) => defaultInstanceRoutes(router));

		expect((await request("/login")).status).toBe(400);
		expect((await request("/login?requestId=unknown_1")).status).toBe(400);
		expect((await request("/login?requestId=device_1")).status).toBe(400);
	});
});

describe("health probes", () => {
	test("/healthy answers without Zitadel", async () => {
		const res = await request("/healthy");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
	});

	test("/ready is unavailable without a usable session cookie secret", async () => {
		const config = ConfigHandler.get();
		const secrets = config.SESSION_COOKIE_SECRET;
		config.SESSION_COOKIE_SECRET = ["too-short"];
		try {
			const res = await request("/ready");
			expect(res.status).toBe(503);
		} finally {
			config.SESSION_COOKIE_SECRET = secrets;
		}
	});
});

describe("ProtocolRoutes.handles", () => {
	test("covers the Zitadel login's server routes and proxy paths", () => {
		for (const path of ["/login", "/healthy", "/ready", "/.well-known/openid-configuration"]) {
			expect(ProtocolRoutes.handles(path)).toBe(true);
		}
		for (const path of [
			"/oauth/v2/token",
			"/oidc/v1/end_session",
			"/idps/callback/x",
			"/saml/v2/SSO",
		]) {
			expect(ProtocolRoutes.handles(path)).toBe(true);
		}
		for (const path of ["/loginname", "/password", "/api/v1/loginname", "/logout"]) {
			expect(ProtocolRoutes.handles(path)).toBe(false);
		}
	});
});
