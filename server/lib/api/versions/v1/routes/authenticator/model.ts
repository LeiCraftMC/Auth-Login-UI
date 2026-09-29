import { z } from "zod";
import { LoginModels } from "../../../../utils/shared-models/loginModels";

export namespace AuthenticatorModel.SetPage {
	export const Query = z.object({
		loginName: z.string().optional(),
		requestId: z.string().optional(),
		organization: z.string().optional(),
		sessionId: z.string().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		/** Set when the session could not be resolved (`error.<key>`). */
		error: z.enum(["sessionExpired", "unknownContext"]).optional(),
		/** No recent user verification in this browser: verify (invite) first. */
		redirect: z.string().optional(),
		branding: LoginModels.Branding.nullable(),
		session: LoginModels.Session.nullable(),
		authMethods: z.array(LoginModels.AuthMethod),
		loginSettings: LoginModels.LoginSettings.nullable(),
		/** IdPs the user can link as first authenticator. */
		identityProviders: z.array(LoginModels.IdentityProvider),
		/** Query of the password / passkey setup links (`initial=true&…`). */
		setupParams: z.string(),
	});
	export type Response = z.infer<typeof Response>;
}
