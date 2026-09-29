import { afterEach, describe, expect, test } from "bun:test";
import { SessionCookieSignature } from "../server/lib/login/sessionCookieSignature";
import { ConfigHandler } from "../server/lib/utils/config";

const ENTRY = {
	id: "334455",
	token: "session-token",
	loginName: "jane@example.com",
	creationTs: "1700000000000",
	expirationTs: "1700086400000",
	changeTs: "1700000000000",
	organization: "org-1",
};

/** Computed with the Zitadel login's `signSession` (v4.19.2) and the preload's secret. */
const ZITADEL_LOGIN_SIGNATURE = "C1clmN1i_lOxBzw5EkmEwxmPZ21KOZU-LHaIyCT2ipk";

const originalSecrets = () => ConfigHandler.get().SESSION_COOKIE_SECRET;
const initialSecrets = originalSecrets();

afterEach(() => {
	ConfigHandler.get().SESSION_COOKIE_SECRET = initialSecrets;
});

describe("SessionCookieSignature", () => {
	test("produces the same signature as the Zitadel login (cookies stay interchangeable)", () => {
		expect(SessionCookieSignature.sign(ENTRY).sig).toBe(ZITADEL_LOGIN_SIGNATURE);
	});

	test("signs and verifies an entry", () => {
		const signed = SessionCookieSignature.sign(ENTRY);
		expect(SessionCookieSignature.verify(signed)).toBe(true);
	});

	test("rejects tampered and unsigned entries", () => {
		const signed = SessionCookieSignature.sign(ENTRY);
		expect(SessionCookieSignature.verify({ ...signed, id: "stolen-id" })).toBe(false);
		expect(SessionCookieSignature.verify({ ...signed, loginName: "eve@example.com" })).toBe(false);
		expect(SessionCookieSignature.verify({ ...ENTRY })).toBe(false);
		expect(SessionCookieSignature.verify({ ...signed, token: "" })).toBe(false);
	});

	test("is independent of key order and undefined optional fields", () => {
		const signed = SessionCookieSignature.sign(ENTRY);
		const reordered = Object.fromEntries(Object.entries(signed).reverse());
		expect(SessionCookieSignature.verify({ ...reordered, requestId: undefined })).toBe(true);
	});

	test("parses a cookie, keeps only valid entries and strips the signature", () => {
		const valid = SessionCookieSignature.sign(ENTRY);
		const forged = { ...valid, id: "other" };
		const parsed = SessionCookieSignature.parseAndVerify<typeof ENTRY & { sig?: string }>(
			JSON.stringify([valid, forged, { id: "x", token: "y" }]),
		);
		expect(parsed).toEqual([ENTRY]);
		expect(SessionCookieSignature.parseAndVerify("not json")).toEqual([]);
		expect(SessionCookieSignature.parseAndVerify(JSON.stringify({ id: "x" }))).toEqual([]);
	});

	test("rotation: signs with the first secret, verifies with all", () => {
		const oldSecret = initialSecrets?.[0] ?? "";
		const signedWithOld = SessionCookieSignature.sign(ENTRY);

		ConfigHandler.get().SESSION_COOKIE_SECRET = [
			"new-session-cookie-secret-0123456789abcd",
			oldSecret,
		];
		const signedWithNew = SessionCookieSignature.sign(ENTRY);

		expect(signedWithNew.sig).not.toBe(signedWithOld.sig);
		expect(SessionCookieSignature.verify(signedWithOld)).toBe(true);
		expect(SessionCookieSignature.verify(signedWithNew)).toBe(true);
	});

	test("rejects secrets shorter than 32 characters instead of falling back", () => {
		ConfigHandler.get().SESSION_COOKIE_SECRET = ["too-short"];
		expect(SessionCookieSignature.getConfigError()).toContain("at least 32 characters");
		expect(SessionCookieSignature.hasSecret()).toBe(false);
		expect(SessionCookieSignature.getStartupNotice()?.level).toBe("error");
		expect(() => SessionCookieSignature.sign(ENTRY)).toThrow();
	});

	test("falls back to the system user key when no dedicated secret is set", () => {
		ConfigHandler.get().SESSION_COOKIE_SECRET = undefined;
		expect(SessionCookieSignature.isUsingCredentialFallback()).toBe(true);
		expect(SessionCookieSignature.getStartupNotice()?.level).toBe("warn");
		expect(SessionCookieSignature.verify(SessionCookieSignature.sign(ENTRY))).toBe(true);
	});
});
