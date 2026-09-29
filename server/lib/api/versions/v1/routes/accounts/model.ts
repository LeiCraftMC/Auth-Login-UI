import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace AccountsModel.Page {
	export const Query = z.object({
		requestId: z.string().optional(),
		organization: z.string().optional(),
		orgDomain: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		branding: LoginModels.Branding,
		sessions: z.array(LoginModels.Session),
	});
	export type Response = z.infer<typeof Response>;
}
