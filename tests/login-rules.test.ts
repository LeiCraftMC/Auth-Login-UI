import { describe, expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { I18n } from "../server/lib/i18n";
import { InstanceRoles } from "../server/lib/login/instanceRoles";
import { MFA } from "../server/lib/login/mfa";
import { Redirects } from "../server/lib/login/redirect";
import { LoginSecurity } from "../server/lib/login/security";
import {
	RequestChallenges_OTPEmail_ReturnCodeSchema,
	RequestChallengesSchema,
} from "../server/lib/zitadel/proto/zitadel/session/v2/challenge_pb";
import { SessionSchema } from "../server/lib/zitadel/proto/zitadel/session/v2/session_pb";
import {
	LoginSettingsSchema,
	PasskeysType,
} from "../server/lib/zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { AuthenticationMethodType } from "../server/lib/zitadel/proto/zitadel/user/v2/user_service_pb";

const serviceConfig = { baseUrl: "http://zitadel.test" };

function passwordSession() {
	return create(SessionSchema, {
		id: "session-1",
		factors: {
			user: { id: "user-1", loginName: "jane@example.com", organizationId: "org-1" },
			password: { verifiedAt: timestampFromMs(Date.now()) },
		},
	});
}

describe("Redirects", () => {
	test("relative paths are internal and safe", () => {
		expect(Redirects.isExternalUrl("/password?loginName=x")).toBe(false);
		expect(Redirects.isSafeRedirectUri("/password")).toBe(true);
	});

	test("protocol-relative and absolute URLs are external", () => {
		expect(Redirects.isExternalUrl("//evil.example")).toBe(true);
		expect(Redirects.isExternalUrl("https://app.example/callback")).toBe(true);
		expect(Redirects.isSafeRedirectUri("https://app.example/callback")).toBe(true);
		expect(Redirects.isSafeRedirectUri("com.example.app://callback")).toBe(true);
	});

	test("script and local schemes are blocked", () => {
		for (const uri of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox",
			"file:///etc/passwd",
			"blob:https://x/1",
			"about:blank",
			"",
		]) {
			expect(Redirects.isSafeRedirectUri(uri)).toBe(false);
		}
	});
});

describe("MFA", () => {
	test("a single configured second factor is used directly", async () => {
		const result = await MFA.checkMFAFactors(
			serviceConfig,
			passwordSession(),
			create(LoginSettingsSchema, {}),
			[AuthenticationMethodType.PASSWORD, AuthenticationMethodType.TOTP],
			undefined,
			"oidc_1",
		);
		expect(result?.redirect).toStartWith("/otp/time-based?");
		const params = new URLSearchParams(result?.redirect.split("?")[1]);
		expect(params.get("loginName")).toBe("jane@example.com");
		expect(params.get("requestId")).toBe("oidc_1");
		expect(params.get("organization")).toBe("org-1");
	});

	test("several second factors lead to the chooser", async () => {
		const result = await MFA.checkMFAFactors(
			serviceConfig,
			passwordSession(),
			create(LoginSettingsSchema, {}),
			[AuthenticationMethodType.TOTP, AuthenticationMethodType.U2F],
		);
		expect(result?.redirect).toStartWith("/mfa?");
	});

	test("forced MFA without a factor leads to the setup", async () => {
		const result = await MFA.checkMFAFactors(
			serviceConfig,
			passwordSession(),
			create(LoginSettingsSchema, { forceMfa: true }),
			[AuthenticationMethodType.PASSWORD],
		);
		expect(result?.redirect).toStartWith("/mfa/set?");
		const params = new URLSearchParams(result?.redirect.split("?")[1]);
		expect(params.get("force")).toBe("true");
		expect(params.get("checkAfter")).toBe("true");
		expect(params.get("sessionId")).toBe("session-1");
	});

	test("a user-verified passkey never needs a second factor", async () => {
		const session = create(SessionSchema, {
			factors: {
				user: { id: "user-1", loginName: "jane@example.com" },
				webAuthN: { verifiedAt: timestampFromMs(Date.now()), userVerified: true },
			},
		});
		const settings = create(LoginSettingsSchema, {
			forceMfa: true,
			passkeysType: PasskeysType.ALLOWED,
		});
		expect(MFA.shouldEnforceMFA(session, settings)).toBe(false);
		expect(
			await MFA.checkMFAFactors(serviceConfig, session, settings, [AuthenticationMethodType.TOTP]),
		).toBeUndefined();
	});

	test("forceMfaLocalOnly applies to passwords, not to IdP logins", () => {
		const settings = create(LoginSettingsSchema, { forceMfaLocalOnly: true });
		expect(MFA.shouldEnforceMFA(passwordSession(), settings)).toBe(true);

		const idpSession = create(SessionSchema, {
			factors: { intent: { verifiedAt: timestampFromMs(Date.now()) } },
		});
		expect(MFA.shouldEnforceMFA(idpSession, settings)).toBe(false);
	});
});

describe("LoginSecurity.sanitizeChallenges (GHSA-3gwm-5wx8-4gm6)", () => {
	test("never lets the client request OTP codes in the response", () => {
		const challenges = create(RequestChallengesSchema, {
			otpSms: { returnCode: true },
			otpEmail: {
				deliveryType: {
					case: "returnCode",
					value: create(RequestChallenges_OTPEmail_ReturnCodeSchema, {}),
				},
			},
		});

		const sanitized = LoginSecurity.sanitizeChallenges(challenges);
		expect(sanitized?.otpSms?.returnCode).toBe(false);
		expect(sanitized?.otpEmail?.deliveryType.case).toBe("sendCode");
		expect(LoginSecurity.sanitizeChallenges(undefined)).toBeUndefined();
	});
});

describe("InstanceRoles.instanceRolesFromClaim", () => {
	const rolesInfo = [{ organizationId: "org-support", organizationDomain: "support.example" }];

	test("takes IAM roles granted by a configured organization (id and domain must match)", () => {
		const raw = {
			"urn:zitadel:iam:org:project:roles": {
				IAM_OWNER: { "org-support": "support.example" },
				IAM_ORG_MANAGER: { "org-support": "support.example" },
				IAM_LOGIN_CLIENT: { "org-other": "other.example" },
				IAM_SPOOFED: { "org-support": "evil.example" },
				ORG_OWNER: { "org-support": "support.example" },
			},
		};
		expect(InstanceRoles.instanceRolesFromClaim(raw, rolesInfo)).toEqual([
			"IAM_ORG_MANAGER",
			"IAM_OWNER",
		]);
	});

	test("ignores malformed claims", () => {
		expect(InstanceRoles.instanceRolesFromClaim(undefined, rolesInfo)).toEqual([]);
		expect(
			InstanceRoles.instanceRolesFromClaim({ "urn:zitadel:iam:org:project:roles": ["x"] }, rolesInfo),
		).toEqual([]);
	});
});

describe("I18n", () => {
	test("picks the first supported language of ui_locales", () => {
		expect(I18n.getValidLocaleFromUILocales(["xx", "de-CH", "en"])).toBe("de");
		expect(I18n.getValidLocaleFromUILocales(["xx"])).toBeNull();
		expect(I18n.getValidLocaleFromUILocales(undefined)).toBeNull();
	});

	test("translates with placeholders and renders missing keys as their path", () => {
		const t = I18n.translator(
			{ password: { complexity: { length: "min {minLength}" } } },
			"password",
		);
		expect(t("complexity.length", { minLength: 8 })).toBe("min 8");
		expect(t("complexity.missing")).toBe("password.complexity.missing");
	});

	test("ships every Zitadel language with the same keys as English", () => {
		const keys = (messages: I18n.Messages, prefix = ""): string[] =>
			Object.entries(messages).flatMap(([key, value]) =>
				typeof value === "string" ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
			);
		const english = keys(I18n.builtInMessages("en")).sort();
		for (const { code } of I18n.LANGS) {
			expect(keys(I18n.builtInMessages(code)).sort()).toEqual(english);
		}
	});
});
