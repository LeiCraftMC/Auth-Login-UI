import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace PasswordModel.Page {
	export const Query = z.object({
		loginName: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		loginSettings: LoginModels.LoginSettings.nullable(),
		defaultOrganization: z.string().optional(),
		session: LoginModels.Session.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace PasswordModel.Send {
	export const Body = z.object({
		loginName: z.string().min(1),
		password: z.string().min(1),
		organization: z.string().optional(),
		defaultOrganization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace PasswordModel.Reset {
	export const Body = z.object({
		loginName: z.string().min(1),
		organization: z.string().optional(),
		defaultOrganization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace PasswordModel.SetPage {
	export const Query = z.object({
		userId: z.string().optional(),
		loginName: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
		code: z.string().optional(),
		initial: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		/** Set when the page cannot be rendered (`loginname.<key>`). */
		error: z.enum(["couldNotGetLoginSettings"]).optional(),
		defaultOrganization: z.string().optional(),
		session: LoginModels.Session.nullable(),
		passwordComplexity: LoginModels.PasswordComplexity.nullable(),
		/** The form, if user and complexity settings could be resolved. */
		form: z
			.object({
				userId: z.string(),
				loginName: z.string(),
				codeRequired: z.boolean(),
			})
			.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace PasswordModel.Set {
	export const Body = z.object({
		userId: z.string().min(1),
		password: z.string().min(1),
		code: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace PasswordModel.ChangePage {
	export const Query = z.object({
		loginName: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
		passwordComplexity: LoginModels.PasswordComplexity.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace PasswordModel.Change {
	export const Body = z.object({
		sessionId: z.string().min(1),
		currentPassword: z.string().min(1),
		password: z.string().min(1),
	});
	export type Body = z.infer<typeof Body>;
}
