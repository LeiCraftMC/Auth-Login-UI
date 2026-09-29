import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace RegisterModel.Page {
	export const Query = z.object({
		organization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		/** The organization to register in (the default organization if none was given). */
		organization: z.string().optional(),
		loginSettings: LoginModels.LoginSettings.nullable(),
		legal: LoginModels.Legal.nullable(),
		passwordComplexity: LoginModels.PasswordComplexity.nullable(),
		/** IdPs that create accounts (automatically or after a form). */
		identityProviders: z.array(LoginModels.IdentityProvider),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace RegisterModel.PasswordPage {
	export const Query = z.object({
		organization: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		organization: z.string().optional(),
		loginSettings: LoginModels.LoginSettings.nullable(),
		legal: LoginModels.Legal.nullable(),
		passwordComplexity: LoginModels.PasswordComplexity.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace RegisterModel.Register {
	export const Body = z.object({
		email: z.string().min(1),
		firstName: z.string().min(1),
		lastName: z.string().min(1),
		password: z.string().optional(),
		organization: z.string().min(1),
		requestId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace RegisterModel.RegisterWithIdp {
	export const Body = z.object({
		email: z.string().min(1),
		firstName: z.string().min(1),
		lastName: z.string().min(1),
		organization: z.string().min(1),
		requestId: z.string().optional(),
		idpIntent: z.object({ idpIntentId: z.string().min(1), idpIntentToken: z.string().min(1) }),
		idpUserId: z.string().min(1),
		idpId: z.string().min(1),
		idpUserName: z.string(),
	});
	export type Body = z.infer<typeof Body>;
}
