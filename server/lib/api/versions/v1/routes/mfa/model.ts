import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace MFAModel.Page {
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
		authMethods: z.array(LoginModels.AuthMethod),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace MFAModel.SetPage {
	export const Query = z.object({
		loginName: z.string().optional(),
		force: z.string().optional(),
		requestId: z.string().optional(),
		organization: z.string().optional(),
		sessionId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
		/** The session proves a primary factor (required to set up a second one). */
		valid: z.boolean(),
		authMethods: z.array(LoginModels.AuthMethod),
		phoneVerified: z.boolean(),
		emailVerified: z.boolean(),
		loginSettings: LoginModels.LoginSettings.nullable(),
		/** Forced MFA with only email OTP available but an unverified email: verify first. */
		redirect: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace MFAModel.Skip {
	export const Body = z.object({
		userId: z.string().min(1),
		loginName: z.string().optional(),
		sessionId: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}
