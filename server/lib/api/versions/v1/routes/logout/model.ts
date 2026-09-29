import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace LogoutModel.Page {
	export const Query = z.object({
		organization: z.string().optional(),
		logout_token: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		sessions: z.array(LoginModels.Session),
		/** From the verified logout token: where to go after the session was ended. */
		postLogoutRedirectUri: z.string().optional(),
		/** From the verified logout token: the login name whose session is ended automatically. */
		logoutHint: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}
