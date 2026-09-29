/**
 * LoginModels — the JSON shapes the frontend receives (Zod schemas → OpenAPI → generated client),
 * mapped from the Zitadel protos. Timestamps are epoch milliseconds, enums are lowercase strings.
 */
import { type Timestamp, timestampMs } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import { IDP_SLUGS, IdpTypes } from "../../../login/idpTypes";
import type { Session } from "../../../zitadel/proto/zitadel/session/v2/session_pb";
import {
	type BrandingSettings,
	type Theme,
	ThemeMode,
} from "../../../zitadel/proto/zitadel/settings/v2/branding_settings_pb";
import type { LegalAndSupportSettings } from "../../../zitadel/proto/zitadel/settings/v2/legal_settings_pb";
import {
	type IdentityProvider,
	type LoginSettings,
	PasskeysType,
	SecondFactorType,
} from "../../../zitadel/proto/zitadel/settings/v2/login_settings_pb";
import type { PasswordComplexitySettings } from "../../../zitadel/proto/zitadel/settings/v2/password_settings_pb";
import { AuthenticationMethodType } from "../../../zitadel/proto/zitadel/user/v2/user_service_pb";

/**
 * Colors of Zitadel's default label policy (cmd/defaults.yaml, light and dark, plus the fallbacks
 * of older Zitadel versions and of the Zitadel login). A color that still has one of these values
 * was not customized, so the LeiCraft_MC design keeps its own color for it.
 */
const ZITADEL_DEFAULT_COLORS = {
	primaryColor: new Set(["#5469d4", "#2073c4", "#bbbafa", "#eeeeee"]),
	backgroundColor: new Set(["#fafafa", "#111827", "#252526", "#212224"]),
	warnColor: new Set(["#cd3d56", "#ff3b5b"]),
	fontColor: new Set(["#000000", "#ffffff"]),
} as const;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** `#ABC` → `#aabbcc` */
function normalizeHex(color: string) {
	const value = color.toLowerCase();
	return value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value;
}

/** A customized color of the label policy, or undefined (unset, invalid or Zitadel's default). */
function customColor(kind: keyof typeof ZITADEL_DEFAULT_COLORS, color: string | undefined) {
	if (!color || !HEX_COLOR.test(color)) return undefined;
	const normalized = normalizeHex(color);
	return ZITADEL_DEFAULT_COLORS[kind].has(normalized) ? undefined : normalized;
}

/** Only absolute http(s) URLs (the asset URLs of Zitadel) are passed to the browser. */
function assetUrl(url: string | undefined) {
	if (!url) return undefined;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
	} catch {
		return undefined;
	}
}

const THEME_MODES = {
	[ThemeMode.UNSPECIFIED]: "unspecified",
	[ThemeMode.AUTO]: "auto",
	[ThemeMode.LIGHT]: "light",
	[ThemeMode.DARK]: "dark",
} as const;

function ms(ts: Timestamp | undefined) {
	return ts ? Number(timestampMs(ts)) : undefined;
}

export namespace LoginModels {
	export const AuthMethod = z.enum([
		"password",
		"passkey",
		"idp",
		"totp",
		"u2f",
		"otp_sms",
		"otp_email",
		"recovery_code",
	]);
	export type AuthMethod = z.infer<typeof AuthMethod>;

	export const SecondFactor = z.enum(["otp", "u2f", "otp_email", "otp_sms", "recovery_codes"]);
	export type SecondFactor = z.infer<typeof SecondFactor>;

	export const IdpSlug = z.enum(IDP_SLUGS);
	export type IdpSlug = z.infer<typeof IdpSlug>;

	const Verified = z.object({ verifiedAt: z.number().optional() });

	export const Session = z.object({
		id: z.string(),
		creationDate: z.number().optional(),
		changeDate: z.number().optional(),
		expirationDate: z.number().optional(),
		factors: z
			.object({
				user: z
					.object({
						id: z.string(),
						loginName: z.string(),
						displayName: z.string(),
						organizationId: z.string(),
						verifiedAt: z.number().optional(),
					})
					.optional(),
				password: Verified.optional(),
				webAuthN: Verified.extend({ userVerified: z.boolean() }).optional(),
				intent: Verified.optional(),
				totp: Verified.optional(),
				otpSms: Verified.optional(),
				otpEmail: Verified.optional(),
			})
			.optional(),
	});
	export type Session = z.infer<typeof Session>;

	export const LoginSettings = z.object({
		allowLocalAuthentication: z.boolean(),
		allowRegister: z.boolean(),
		allowExternalIdp: z.boolean(),
		disableLoginWithEmail: z.boolean(),
		disableLoginWithPhone: z.boolean(),
		hidePasswordReset: z.boolean(),
		ignoreUnknownUsernames: z.boolean(),
		passkeysAllowed: z.boolean(),
		secondFactors: z.array(SecondFactor),
		defaultRedirectUri: z.string(),
	});
	export type LoginSettings = z.infer<typeof LoginSettings>;

	/** One theme of the label policy; colors only when customized (see `customColor`). */
	export const BrandingTheme = z.object({
		primaryColor: z.string().optional(),
		backgroundColor: z.string().optional(),
		warnColor: z.string().optional(),
		fontColor: z.string().optional(),
		logoUrl: z.string().optional(),
		iconUrl: z.string().optional(),
	});
	export type BrandingTheme = z.infer<typeof BrandingTheme>;

	/** The label policy (branding) of the instance / organization. */
	export const Branding = z.object({
		light: BrandingTheme,
		dark: BrandingTheme,
		/** Custom font file (applied with the LeiCraft_MC font as fallback). */
		fontUrl: z.string().optional(),
		/** `light` / `dark` force the theme; `auto` follows the system; `unspecified` = LeiCraft_MC default (dark). */
		themeMode: z.enum(["unspecified", "auto", "light", "dark"]),
		hideLoginNameSuffix: z.boolean(),
	});
	export type Branding = z.infer<typeof Branding>;

	export const IdentityProvider = z.object({ id: z.string(), name: z.string(), type: IdpSlug });
	export type IdentityProvider = z.infer<typeof IdentityProvider>;

	export const PasswordComplexity = z.object({
		minLength: z.number(),
		requiresUppercase: z.boolean(),
		requiresLowercase: z.boolean(),
		requiresNumber: z.boolean(),
		requiresSymbol: z.boolean(),
	});
	export type PasswordComplexity = z.infer<typeof PasswordComplexity>;

	export const Legal = z.object({
		tosLink: z.string(),
		privacyPolicyLink: z.string(),
		helpLink: z.string(),
	});
	export type Legal = z.infer<typeof Legal>;

	export const SamlData = z.object({ url: z.string(), fields: z.record(z.string(), z.string()) });
	export type SamlData = z.infer<typeof SamlData>;

	/** Result of a login step: navigate to `redirect`, or POST `samlData`; nothing = stay. */
	export const FlowStep = z.object({
		redirect: z.string().optional(),
		samlData: SamlData.optional(),
	});
	export type FlowStep = z.infer<typeof FlowStep>;

	/** A JSON object passed through unchanged (WebAuthn options / credentials). */
	export const JsonObject = z.record(z.string(), z.any());
	export type JsonObject = z.infer<typeof JsonObject>;
}

export class LoginDTO {
	static authMethod(method: AuthenticationMethodType): LoginModels.AuthMethod | null {
		switch (method) {
			case AuthenticationMethodType.PASSWORD:
				return "password";
			case AuthenticationMethodType.PASSKEY:
				return "passkey";
			case AuthenticationMethodType.IDP:
				return "idp";
			case AuthenticationMethodType.TOTP:
				return "totp";
			case AuthenticationMethodType.U2F:
				return "u2f";
			case AuthenticationMethodType.OTP_SMS:
				return "otp_sms";
			case AuthenticationMethodType.OTP_EMAIL:
				return "otp_email";
			case AuthenticationMethodType.RECOVERY_CODE:
				return "recovery_code";
			default:
				return null;
		}
	}

	static authMethods(methods: AuthenticationMethodType[] | undefined): LoginModels.AuthMethod[] {
		return (methods ?? []).map(LoginDTO.authMethod).filter((m): m is LoginModels.AuthMethod => !!m);
	}

	static secondFactor(factor: SecondFactorType): LoginModels.SecondFactor | null {
		switch (factor) {
			case SecondFactorType.TOTP: // == OTP (alias)
				return "otp";
			case SecondFactorType.U2F:
				return "u2f";
			case SecondFactorType.OTP_EMAIL:
				return "otp_email";
			case SecondFactorType.OTP_SMS:
				return "otp_sms";
			case SecondFactorType.RECOVERY_CODES:
				return "recovery_codes";
			default:
				return null;
		}
	}

	static session(session: Session): LoginModels.Session {
		const factors = session.factors;
		return {
			id: session.id,
			creationDate: ms(session.creationDate),
			changeDate: ms(session.changeDate),
			expirationDate: ms(session.expirationDate),
			factors: factors
				? {
						user: factors.user
							? {
									id: factors.user.id,
									loginName: factors.user.loginName,
									displayName: factors.user.displayName,
									organizationId: factors.user.organizationId,
									verifiedAt: ms(factors.user.verifiedAt),
								}
							: undefined,
						password: factors.password ? { verifiedAt: ms(factors.password.verifiedAt) } : undefined,
						webAuthN: factors.webAuthN
							? {
									verifiedAt: ms(factors.webAuthN.verifiedAt),
									userVerified: factors.webAuthN.userVerified,
								}
							: undefined,
						intent: factors.intent ? { verifiedAt: ms(factors.intent.verifiedAt) } : undefined,
						totp: factors.totp ? { verifiedAt: ms(factors.totp.verifiedAt) } : undefined,
						otpSms: factors.otpSms ? { verifiedAt: ms(factors.otpSms.verifiedAt) } : undefined,
						otpEmail: factors.otpEmail ? { verifiedAt: ms(factors.otpEmail.verifiedAt) } : undefined,
					}
				: undefined,
		};
	}

	static optionalSession(session: Session | undefined | null): LoginModels.Session | null {
		return session ? LoginDTO.session(session) : null;
	}

	static loginSettings(
		settings: LoginSettings | undefined | null,
	): LoginModels.LoginSettings | null {
		if (!settings) return null;
		return {
			allowLocalAuthentication: settings.allowLocalAuthentication,
			allowRegister: settings.allowRegister,
			allowExternalIdp: settings.allowExternalIdp,
			disableLoginWithEmail: settings.disableLoginWithEmail,
			disableLoginWithPhone: settings.disableLoginWithPhone,
			hidePasswordReset: settings.hidePasswordReset,
			ignoreUnknownUsernames: settings.ignoreUnknownUsernames,
			passkeysAllowed: settings.passkeysType === PasskeysType.ALLOWED,
			secondFactors: settings.secondFactors
				.map(LoginDTO.secondFactor)
				.filter((f): f is LoginModels.SecondFactor => !!f),
			defaultRedirectUri: settings.defaultRedirectUri,
		};
	}

	static brandingTheme(theme: Theme | undefined): LoginModels.BrandingTheme {
		return {
			primaryColor: customColor("primaryColor", theme?.primaryColor),
			backgroundColor: customColor("backgroundColor", theme?.backgroundColor),
			warnColor: customColor("warnColor", theme?.warnColor),
			fontColor: customColor("fontColor", theme?.fontColor),
			logoUrl: assetUrl(theme?.logoUrl),
			iconUrl: assetUrl(theme?.iconUrl),
		};
	}

	/**
	 * The complete label policy on top of the LeiCraft_MC design: every customized value is applied
	 * by the frontend (useBrandingTheme), Zitadel's defaults keep the LeiCraft_MC look.
	 */
	static branding(branding: BrandingSettings | undefined | null): LoginModels.Branding {
		return {
			light: LoginDTO.brandingTheme(branding?.lightTheme),
			dark: LoginDTO.brandingTheme(branding?.darkTheme),
			fontUrl: assetUrl(branding?.fontUrl),
			themeMode: THEME_MODES[branding?.themeMode ?? ThemeMode.UNSPECIFIED] ?? "unspecified",
			hideLoginNameSuffix: !!branding?.hideLoginNameSuffix,
		};
	}

	static identityProviders(idps: IdentityProvider[] | undefined): LoginModels.IdentityProvider[] {
		const result: LoginModels.IdentityProvider[] = [];
		for (const idp of idps ?? []) {
			try {
				result.push({ id: idp.id, name: idp.name, type: IdpTypes.toSlug(idp.type) });
			} catch {
				// unknown types are not rendered (the Zitadel login renders no button for them)
			}
		}
		return result;
	}

	static passwordComplexity(
		settings: PasswordComplexitySettings | undefined | null,
	): LoginModels.PasswordComplexity | null {
		if (!settings) return null;
		return {
			minLength: Number(settings.minLength),
			requiresUppercase: settings.requiresUppercase,
			requiresLowercase: settings.requiresLowercase,
			requiresNumber: settings.requiresNumber,
			requiresSymbol: settings.requiresSymbol,
		};
	}

	static legal(settings: LegalAndSupportSettings | undefined | null): LoginModels.Legal | null {
		if (!settings) return null;
		return {
			tosLink: settings.tosLink,
			privacyPolicyLink: settings.privacyPolicyLink,
			helpLink: settings.helpLink,
		};
	}
}
