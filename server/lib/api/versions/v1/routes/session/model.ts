import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace SessionModel.Update {
	const Code = z.object({ code: z.string().min(1) });

	export const Body = z.object({
		loginName: z.string().optional(),
		sessionId: z.string().optional(),
		organization: z.string().optional(),
		requestId: z.string().optional(),
		/** Challenges to request; the server fills in the WebAuthn domain and the OTP email link. */
		challenges: z
			.object({
				webAuthN: z
					.object({ userVerificationRequirement: z.enum(["required", "preferred", "discouraged"]) })
					.optional(),
				otpEmail: z.boolean().optional(),
				otpSms: z.boolean().optional(),
			})
			.optional(),
		/** Second-factor codes to check. */
		checks: z
			.object({
				totp: Code.optional(),
				otpSms: Code.optional(),
				otpEmail: Code.optional(),
			})
			.optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		session: LoginModels.Session,
		challenges: z
			.object({
				webAuthN: z
					.object({
						/** `PublicKeyCredentialRequestOptions` for `navigator.credentials.get`. */
						publicKeyCredentialRequestOptions: LoginModels.JsonObject.optional(),
					})
					.optional(),
			})
			.optional(),
		authMethods: z.array(LoginModels.AuthMethod).optional(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace SessionModel.Continue {
	export const Body = z.object({
		sessionId: z.string().min(1),
		requestId: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace SessionModel.Clear {
	export const Params = z.object({
		sessionId: z.string().min(1),
	});
	export type Params = z.infer<typeof Params>;
}
