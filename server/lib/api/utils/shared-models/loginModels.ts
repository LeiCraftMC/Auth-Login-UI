/**
 * LoginModels — the JSON shapes the frontend receives (Zod schemas → OpenAPI → generated client),
 * mapped from the Zitadel protos. Timestamps are epoch milliseconds, enums are lowercase strings.
 */
import { type Timestamp, timestampMs } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import { IDP_SLUGS, IdpTypes } from "../../../login/idpTypes";
import type { Session } from "../../../zitadel/proto/zitadel/session/v2/session_pb";
import type { BrandingSettings } from "../../../zitadel/proto/zitadel/settings/v2/branding_settings_pb";
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
 * Colors of Zitadel's default label policy (cmd/defaults.yaml). An instance that still uses them
 * has not customized its branding, so the LeiCraft_MC primary color is kept.
 */
const ZITADEL_DEFAULT_PRIMARY_COLORS = new Set(["#5469d4", "#2073c4", "#bbbafa", "#eeeeee"]);

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

	export const Branding = z.object({
		/** Logo for dark backgrounds (the login is dark-only), if the instance/org set one. */
		logoUrl: z.string().optional(),
		iconUrl: z.string().optional(),
		/** Customized primary color (hex); unset when the Zitadel default is still in use. */
		primaryColor: z.string().optional(),
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

	/**
	 * LeiCraft_MC design with the instance's identity: the dark-theme logo/icon and the primary
	 * color, unless it is still Zitadel's default.
	 */
	static branding(branding: BrandingSettings | undefined | null): LoginModels.Branding {
		const dark = branding?.darkTheme;
		const light = branding?.lightTheme;
		const primary = dark?.primaryColor || light?.primaryColor;
		const customPrimary =
			primary && HEX_COLOR.test(primary) && !ZITADEL_DEFAULT_PRIMARY_COLORS.has(primary.toLowerCase())
				? primary
				: undefined;

		return {
			logoUrl: dark?.logoUrl || undefined,
			iconUrl: dark?.iconUrl || light?.iconUrl || undefined,
			primaryColor: customPrimary,
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
