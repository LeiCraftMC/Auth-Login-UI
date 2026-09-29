import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace OTPModel {
	export const Method = z.enum(["time-based", "sms", "email"]);
	export type Method = z.infer<typeof Method>;

	export const Params = z.object({ method: Method });
	export type Params = z.infer<typeof Params>;
}

export namespace OTPModel.Page {
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
		loginSettings: LoginModels.LoginSettings.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace OTPModel.Set {
	export const Body = z.object({
		loginName: z.string().optional(),
		organization: z.string().optional(),
		sessionId: z.string().optional(),
		requestId: z.string().optional(),
		checkAfter: z.boolean().optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
		loginSettings: LoginModels.LoginSettings.nullable(),
		/** TOTP secret to show as QR code (method `time-based`). */
		totp: z.object({ uri: z.string(), secret: z.string() }).optional(),
		/** Registration refused (e.g. the session may not enroll). */
		error: z.string().optional(),
		/** Where "continue" leads. */
		continueUrl: z.string(),
		/** Set when the page must be left immediately (email/SMS with `checkAfter`). */
		redirect: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace OTPModel.VerifyTOTP {
	export const Body = z.object({
		code: z.string().min(1),
		loginName: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}
