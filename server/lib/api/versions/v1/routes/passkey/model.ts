import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace PasskeyModel.Page {
	export const Query = z.object({
		loginName: z.string().optional(),
		requestId: z.string().optional(),
		organization: z.string().optional(),
		sessionId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace PasskeyModel.Send {
	export const Body = z.object({
		loginName: z.string().optional(),
		sessionId: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
		/** The WebAuthn assertion (`navigator.credentials.get`), base64url-encoded. */
		credentialAssertionData: LoginModels.JsonObject,
	});
	export type Body = z.infer<typeof Body>;
}

export namespace PasskeyModel.SetPage {
	export const Query = z.object({
		userId: z.string().optional(),
		loginName: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
		user: z.object({ loginName: z.string(), displayName: z.string().optional() }).nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace PasskeyModel.Registration {
	export const Body = z.object({
		sessionId: z.string().optional(),
		userId: z.string().optional(),
		code: z.string().optional(),
		codeId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		passkeyId: z.string(),
		/** `PublicKeyCredentialCreationOptions` for `navigator.credentials.create`. */
		publicKeyCredentialCreationOptions: LoginModels.JsonObject,
	});
	export type Response = z.infer<typeof Response>;
}

export namespace PasskeyModel.VerifyRegistration {
	export const Body = z.object({
		passkeyId: z.string().min(1),
		passkeyName: z.string().optional(),
		publicKeyCredential: LoginModels.JsonObject,
		sessionId: z.string().optional(),
		userId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		loginName: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}
