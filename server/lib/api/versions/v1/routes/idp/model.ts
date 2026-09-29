import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace IdpModel.Page {
	export const Query = z.object({
		requestId: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		identityProviders: z.array(LoginModels.IdentityProvider),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace IdpModel.LdapPage {
	export const Query = z.object({
		idpId: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
	});
	export type Response = z.infer<typeof Response>;
}

export namespace IdpModel.FailurePage {
	export const Query = z.object({
		organization: z.string().optional(),
		userId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		loginSettings: LoginModels.LoginSettings.nullable(),
		user: z.object({ loginName: z.string(), displayName: z.string().optional() }).nullable(),
		/** Alternative methods of the user (with `userId`). */
		authMethods: z.array(LoginModels.AuthMethod),
		/** Query of the alternative-method links. */
		params: z.string(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace IdpModel.Start {
	export const Body = z.object({
		id: z.string().min(1),
		provider: LoginModels.IdpSlug,
		requestId: z.string().optional(),
		organization: z.string().optional(),
		/** Link the IdP to this session's user instead of signing in. */
		sessionId: z.string().optional(),
		postErrorRedirectUrl: z.string().optional(),
		loginHint: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace IdpModel.Ldap {
	export const Body = z.object({
		username: z.string().min(1),
		password: z.string().min(1),
		idpId: z.string().min(1),
		link: z.boolean(),
		requestId: z.string().optional(),
		organization: z.string().optional(),
		postErrorRedirectUrl: z.string().optional(),
		linkToSessionId: z.string().optional(),
		linkFingerprint: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace IdpModel.Process {
	export const Body = z.object({
		provider: z.string().min(1),
		id: z.string().min(1),
		token: z.string().min(1),
		requestId: z.string().optional(),
		organization: z.string().optional(),
		postErrorRedirectUrl: z.string().optional(),
		linkToSessionId: z.string().optional(),
		linkFingerprint: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}
