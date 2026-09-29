import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace SignedInModel.Page {
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
		/** Target of "continue"; omitted when it would be this page again. */
		redirectUri: z.string().optional(),
	});
	export type Response = z.infer<typeof Response>;
}
