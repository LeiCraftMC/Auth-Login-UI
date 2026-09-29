import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

const Avatar = z.object({
	loginName: z.string(),
	displayName: z.string().optional(),
	/** Offer switching the account (only with a session). */
	showDropdown: z.boolean(),
});

export namespace VerifyModel.Page {
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
		avatar: Avatar.nullable(),
		/** The user to verify (the enumeration placeholder while protection applies). */
		userId: z.string().optional(),
		/** Submit a code from the email link automatically (AUTO_SUBMIT_CODE). */
		autoSubmit: z.boolean(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace VerifyModel.SuccessPage {
	export const Query = z.object({
		loginName: z.string().optional(),
		organization: z.string().optional(),
		userId: z.string().optional(),
		requestId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		session: LoginModels.Session.nullable(),
		avatar: Avatar.nullable(),
		/** Re-enters the login flow when there is a request to finish. */
		continueUrl: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace VerifyModel.Send {
	export const Body = z.object({
		userId: z.string().min(1),
		loginName: z.string().optional(),
		organization: z.string().optional(),
		code: z.string().min(1),
		isInvite: z.boolean(),
		requestId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace VerifyModel.Resend {
	export const Body = z.object({
		userId: z.string().min(1),
		isInvite: z.boolean(),
		requestId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}
