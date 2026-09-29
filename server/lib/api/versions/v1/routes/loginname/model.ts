import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace LoginNameModel.Page {
	export const Query = z.object({
		loginName: z.string().optional(),
		requestId: z.string().optional(),
		organization: z.string().optional(),
		orgDomain: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		loginSettings: LoginModels.LoginSettings.nullable(),
		identityProviders: z.array(LoginModels.IdentityProvider),
		defaultOrganization: z.string().optional(),
		/** login_hint for IdP buttons (`<loginName>@<orgDomain>` if only the local part was given). */
		idpLoginHint: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace LoginNameModel.Send {
	export const Body = z.object({
		loginName: z.string().min(1),
		requestId: z.string().optional(),
		organization: z.string().optional(),
		defaultOrganization: z.string().optional(),
		suffix: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}
