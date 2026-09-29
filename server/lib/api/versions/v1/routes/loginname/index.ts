import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginName } from "../../../../../login/loginname";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { LoginNameModel } from "./model";

export const router = new Hono().basePath("/loginname");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Login name page",
		description: "Login settings, identity providers and branding for the login-name page.",
		tags: [DOCS_TAGS.LOGIN_NAME],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", LoginNameModel.Page.Response),
		),
	}),

	zValidator("query", LoginNameModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, organization, orgDomain } = c.req.valid("query");

		// With an org domain suffix the login name may only be the local part.
		const idpLoginHint =
			loginName && orgDomain && !loginName.includes("@") ? `${loginName}@${orgDomain}` : loginName;

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);
		const org = organization ?? defaultOrganization;

		const [loginSettings, idps, branding] = await Promise.all([
			ZitadelAPI.getLoginSettings({ serviceConfig: ctx.serviceConfig, organization: org }),
			ZitadelAPI.getActiveIdentityProviders({ serviceConfig: ctx.serviceConfig, orgId: org }),
			PageHelpers.branding(ctx, org),
		]);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			loginSettings: LoginDTO.loginSettings(loginSettings),
			identityProviders: LoginDTO.identityProviders(idps.identityProviders),
			defaultOrganization,
			idpLoginHint,
		} satisfies LoginNameModel.Page.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Submit login name",
		description:
			"Finds the user, starts a session and returns the next step (password, passkey, IdP, verification, registration).",
		tags: [DOCS_TAGS.LOGIN_NAME],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Next step resolved", LoginModels.FlowStep),
			APIResponseSpec.badRequest("The login name could not be used"),
		),
	}),

	zValidator("json", LoginNameModel.Send.Body),

	async (c) => {
		const result = await LoginName.sendLoginname(LoginContext.from(c), c.req.valid("json"));
		return LoginResponses.flow(c, "Next step resolved", result);
	},
);
