import { afterEach, describe, expect, test } from "bun:test";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { API } from "../server/lib/api";
import { SessionCookieSignature } from "../server/lib/login/sessionCookieSignature";
import { SessionService } from "../server/lib/zitadel/proto/zitadel/session/v2/session_service_pb";
import { UserState } from "../server/lib/zitadel/proto/zitadel/user/v2/user_pb";
import {
	AuthenticationMethodType,
	UserService,
} from "../server/lib/zitadel/proto/zitadel/user/v2/user_service_pb";
import { makeAPIRequest } from "./helpers/api";
import { TEST_PUBLIC_HOST } from "./helpers/preload";
import { defaultInstanceRoutes, mockZitadel, resetZitadelMock } from "./helpers/zitadel";

afterEach(() => {
	resetZitadelMock();
});

const JANE = {
	userId: "user-1",
	preferredLoginName: "jane@example.com",
	state: UserState.ACTIVE,
	details: { resourceOwner: "org-1" },
	type: {
		case: "human" as const,
		value: { profile: { displayName: "Jane Doe" }, email: { email: "jane@example.com" } },
	},
};

describe("GET /v1/loginname", () => {
	test("returns the page data of the request's instance", async () => {
		const { calls } = mockZitadel((router) => defaultInstanceRoutes(router));

		const data = await makeAPIRequest("/v1/loginname");

		expect(data.loginSettings.allowLocalAuthentication).toBe(true);
		expect(data.loginSettings.allowRegister).toBe(true);
		expect(data.defaultOrganization).toBe("default-org");
		expect(data.branding.logoUrl).toBe("https://assets.test/logo.png");
		// Zitadel's default primary color keeps the LeiCraft_MC color
		expect(data.branding.primaryColor).toBeUndefined();

		// the virtual instance is selected by the request host
		expect(calls.length).toBeGreaterThan(0);
		for (const serviceConfig of calls) {
			expect(serviceConfig.instanceHost).toBe(TEST_PUBLIC_HOST);
			expect(serviceConfig.publicHost).toBe(TEST_PUBLIC_HOST);
		}
	});

	test("prefers the x-zitadel-instance-host / public-host headers of a proxy", async () => {
		const { calls } = mockZitadel((router) => defaultInstanceRoutes(router));

		await makeAPIRequest("/v1/loginname", {
			additionalOptions: {
				headers: {
					"x-zitadel-instance-host": "instance.internal",
					"x-zitadel-public-host": "auth.example.com",
				},
			},
		});

		expect(calls[0]?.instanceHost).toBe("instance.internal");
		expect(calls[0]?.publicHost).toBe("auth.example.com");
	});
});

describe("POST /v1/loginname", () => {
	test("blocks cross-origin state changes (server-action origin check)", async () => {
		mockZitadel((router) => defaultInstanceRoutes(router));

		await makeAPIRequest(
			"/v1/loginname",
			{
				method: "POST",
				body: { loginName: "jane@example.com" },
				additionalOptions: { headers: { origin: "https://evil.example" } },
			},
			403,
		);
	});

	test("creates a signed session cookie and continues with the password", async () => {
		mockZitadel((router) => {
			defaultInstanceRoutes(router);
			router.service(UserService, {
				listUsers: () => ({ details: { totalResult: 1n }, result: [JANE] }),
				listAuthenticationMethodTypes: () => ({
					authMethodTypes: [AuthenticationMethodType.PASSWORD],
				}),
			});
			router.service(SessionService, {
				createSession: () => ({
					sessionId: "session-1",
					sessionToken: "token-1",
					details: { changeDate: timestampFromMs(Date.now()) },
				}),
				getSession: () => ({
					session: {
						id: "session-1",
						creationDate: timestampFromMs(Date.now()),
						changeDate: timestampFromMs(Date.now()),
						expirationDate: timestampFromMs(Date.now() + 60_000),
						factors: {
							user: {
								id: "user-1",
								loginName: "jane@example.com",
								displayName: "Jane Doe",
								organizationId: "org-1",
							},
						},
					},
				}),
			});
		});

		const res = await API.getApp().request("/v1/loginname", {
			method: "POST",
			headers: {
				host: TEST_PUBLIC_HOST,
				origin: `http://${TEST_PUBLIC_HOST}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ loginName: "jane@example.com", requestId: "oidc_V2_1" }),
		});
		expect(res.status).toBe(200);

		const body = (await res.json()) as { data: { redirect: string } };
		const redirect = new URL(body.data.redirect, "http://x");
		expect(redirect.pathname).toBe("/password");
		expect(redirect.searchParams.get("loginName")).toBe("jane@example.com");
		expect(redirect.searchParams.get("requestId")).toBe("oidc_V2_1");

		const cookie = res.headers.getSetCookie().find((c) => c.startsWith("sessions="));
		expect(cookie).toBeDefined();
		expect(cookie).toContain("HttpOnly");
		const value = decodeURIComponent(cookie?.split(";")[0]?.slice("sessions=".length) ?? "");
		const entries = SessionCookieSignature.parseAndVerify<{
			id: string;
			token: string;
			loginName: string;
		}>(value);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.id).toBe("session-1");
		expect(entries[0]?.loginName).toBe("jane@example.com");
	});

	test("does not reveal unknown users when ignoreUnknownUsernames is set", async () => {
		mockZitadel((router) => {
			defaultInstanceRoutes(router, { loginSettings: { ignoreUnknownUsernames: true } });
			router.service(UserService, {
				listUsers: () => ({ details: { totalResult: 0n }, result: [] }),
			});
		});

		const data = await makeAPIRequest("/v1/loginname", {
			method: "POST",
			body: { loginName: "nobody@example.com" },
		});

		const redirect = new URL(data.redirect, "http://x");
		expect(redirect.pathname).toBe("/password");
		expect(redirect.searchParams.get("loginName")).toBe("nobody@example.com");
	});
});

describe("GET /v1/settings/i18n", () => {
	test("resolves the language from the NEXT_LOCALE cookie within the allowed languages", async () => {
		mockZitadel((router) => defaultInstanceRoutes(router));

		const de = await makeAPIRequest("/v1/settings/i18n", { cookie: "NEXT_LOCALE=de" });
		expect(de.locale).toBe("de");
		expect(de.languages.map((l: { code: string }) => l.code)).toEqual(["en", "de"]);

		// not allowed by the instance → default language
		const fr = await makeAPIRequest("/v1/settings/i18n", { cookie: "NEXT_LOCALE=fr" });
		expect(fr.locale).toBe("en");
		expect(fr.messages.common.title).toBe("Login with LeiCraft_MC Auth");
	});
});
