import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { I18n } from "../../../../../i18n";
import { LoginContext } from "../../../../../login/context";
import { LoginCookies } from "../../../../../login/cookies";
import { APIResponse } from "../../../../utils/api-res";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { SettingsModel } from "./model";

export const router = new Hono().basePath("/settings");

router.get(
	"/branding",

	APIRouteSpec.unauthenticated({
		summary: "Get branding",
		description:
			"Branding (logo, icon, customized primary color) of the organization, the default organization or the instance.",
		tags: [DOCS_TAGS.SETTINGS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Branding loaded", SettingsModel.Branding.Response),
		),
	}),

	zValidator("query", SettingsModel.Branding.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { organization, fallbackToDefault } = c.req.valid("query");

		const defaultOrganization =
			fallbackToDefault === "true"
				? await PageHelpers.defaultOrganization(ctx, organization)
				: undefined;

		return APIResponse.success(c, "Branding loaded", {
			branding: await PageHelpers.branding(ctx, organization ?? defaultOrganization),
			defaultOrganization,
		} satisfies SettingsModel.Branding.Response);
	},
);

router.get(
	"/i18n",

	APIRouteSpec.unauthenticated({
		summary: "Get translations",
		description:
			"The resolved locale (instance default, Accept-Language, language cookie), the selectable languages and the merged messages incl. the instance/organization custom texts.",
		tags: [DOCS_TAGS.SETTINGS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Translations loaded", SettingsModel.I18n.Response),
		),
	}),

	zValidator("query", SettingsModel.I18n.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { locale, languages, messages } = await ctx.i18n();
		return APIResponse.success(c, "Translations loaded", {
			locale,
			languages,
			messages,
		} satisfies SettingsModel.I18n.Response);
	},
);

router.put(
	"/language",

	APIRouteSpec.unauthenticated({
		summary: "Set language",
		description: "Stores the selected language in the language cookie.",
		tags: [DOCS_TAGS.SETTINGS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Language updated"),
		),
	}),

	zValidator("json", SettingsModel.Language.Body),

	async (c) => {
		const { language } = c.req.valid("json");
		if (!I18n.isValidLanguage(language)) {
			return APIResponse.badRequest(c, "Unsupported language");
		}
		LoginCookies.setLanguage(LoginContext.from(c), language.trim().toLowerCase());
		return APIResponse.successNoData(c, "Language updated");
	},
);
