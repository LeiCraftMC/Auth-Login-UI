import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace U2FModel.Page {
	export const Query = z.object({
		loginName: z.string().optional(),
		requestId: z.string().optional(),
		sessionId: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace U2FModel.SetPage {
	export const Query = z.object({
		loginName: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
		/** Only an authenticated session (or a fresh user verification) may add a security key. */
		enrollmentAuthorized: z.boolean(),
		loginSettings: LoginModels.LoginSettings.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace U2FModel.Registration {
	export const Body = z.object({
		sessionId: z.string().min(1),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		u2fId: z.string(),
		publicKeyCredentialCreationOptions: LoginModels.JsonObject,
	});
	export type Response = z.infer<typeof Response>;
}

export namespace U2FModel.VerifyRegistration {
	export const Body = z.object({
		u2fId: z.string().min(1),
		passkeyName: z.string().optional(),
		publicKeyCredential: LoginModels.JsonObject,
		sessionId: z.string().min(1),
	});
	export type Body = z.infer<typeof Body>;
}
