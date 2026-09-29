import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace SettingsModel.Branding {
	export const Query = z.object({
		organization: z.string().optional(),
		/** Use the default organization's branding when no organization is given. */
		fallbackToDefault: z.enum(["true", "false"]).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		defaultOrganization: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace SettingsModel.I18n {
	export const Query = z.object({
		organization: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		locale: z.string(),
		languages: z.array(z.object({ code: z.string(), name: z.string() })),
		messages: LoginModels.JsonObject,
	});
	export type Response = z.infer<typeof Response>;
}

export namespace SettingsModel.Language {
	export const Body = z.object({
		language: z.string().min(2).max(10),
	});
	export type Body = z.infer<typeof Body>;
}
