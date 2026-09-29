import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace DeviceModel.Page {
	export const Query = z.object({
		organization: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
	});
	export type Response = z.infer<typeof Response>;
}

export namespace DeviceModel.ConsentPage {
	export const Query = z.object({
		user_code: z.string().optional(),
		requestId: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		/** Set when the page cannot be rendered (`error.<key>`). */
		error: z.enum(["noUserCode", "noDeviceRequest"]).optional(),
		branding: LoginModels.Branding.nullable(),
		deviceAuthorizationRequest: z
			.object({ id: z.string(), appName: z.string(), scope: z.array(z.string()) })
			.nullable(),
		/** "Allow" continues with the login. */
		nextUrl: z.string(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace DeviceModel.Code {
	export const Body = z.object({
		userCode: z.string().min(1),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		deviceAuthorizationRequestId: z.string(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace DeviceModel.Deny {
	export const Body = z.object({
		deviceAuthorizationId: z.string().min(1),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace DeviceModel.Authorize {
	export const Body = z.object({
		/** `device_<id>` */
		requestId: z.string().min(1),
		sessionId: z.string().optional(),
		loginName: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}
