/**
 * Named shapes of the API responses, derived from the generated client (the OpenAPI spec inlines
 * the shared `LoginModels` schemas of server/lib/api/utils/shared-models/loginModels.ts).
 */
import type {
	GetAccountsResponses,
	GetIdpFailureResponses,
	GetLoginnameResponses,
	GetRegisterResponses,
	GetSettingsBrandingResponses,
	GetSettingsI18nResponses,
	PostLoginnameResponses,
} from "~/api-client/types.gen";

export type LoginBranding = GetSettingsBrandingResponses[200]["data"]["branding"];

export type LoginBrandingTheme = LoginBranding["light"];

export type LoginThemeMode = LoginBranding["themeMode"];

export type LoginSettings = NonNullable<GetLoginnameResponses[200]["data"]["loginSettings"]>;

export type LoginSecondFactor = LoginSettings["secondFactors"][number];

export type LoginIdentityProvider = GetLoginnameResponses[200]["data"]["identityProviders"][number];

export type LoginIdpSlug = LoginIdentityProvider["type"];

export type LoginSession = GetAccountsResponses[200]["data"]["sessions"][number];

export type LoginAuthMethod = GetIdpFailureResponses[200]["data"]["authMethods"][number];

export type LoginPasswordComplexity = NonNullable<
	GetRegisterResponses[200]["data"]["passwordComplexity"]
>;

export type LoginLegal = NonNullable<GetRegisterResponses[200]["data"]["legal"]>;

export type LoginFlowStep = PostLoginnameResponses[200]["data"];

export type LoginSamlData = NonNullable<LoginFlowStep["samlData"]>;

export type LoginI18n = GetSettingsI18nResponses[200]["data"];

export type LoginLanguage = LoginI18n["languages"][number];

/** The `{ success: false, message }` envelope every failed `useAPI` call resolves to. */
export type LoginAPIFailure = { success: false; code: number; message: string };
