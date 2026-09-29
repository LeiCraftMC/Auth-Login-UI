import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginRegister } from "../../../../../login/register";
import { Logger } from "../../../../../utils/logger";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { RegisterModel } from "./model";

export const router = new Hono().basePath("/register");

async function loadRegistrationSettings(ctx: LoginContext, requestedOrganization?: string) {
	const organization =
		requestedOrganization ?? (await PageHelpers.defaultOrganization(ctx, requestedOrganization));
	const serviceConfig = ctx.serviceConfig;

	const [legal, passwordComplexity, branding, loginSettings] = await Promise.all([
		ZitadelAPI.getLegalAndSupportSettings({ serviceConfig, organization }),
		ZitadelAPI.getPasswordComplexitySettings({ serviceConfig, organization }),
		PageHelpers.branding(ctx, organization),
		ZitadelAPI.getLoginSettings({ serviceConfig, organization }),
	]);

	return { organization, legal, passwordComplexity, branding, loginSettings };
}

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Register page",
		description: "Registration settings, legal links and IdPs that can create accounts.",
		tags: [DOCS_TAGS.REGISTER],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", RegisterModel.Page.Response),
		),
	}),

	zValidator("query", RegisterModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const settings = await loadRegistrationSettings(ctx, c.req.valid("query").organization);

		const { identityProviders } = await ZitadelAPI.getActiveIdentityProviders({
			serviceConfig: ctx.serviceConfig,
			orgId: settings.organization,
		});

		return APIResponse.success(c, "Page data loaded", {
			branding: settings.branding,
			organization: settings.organization,
			loginSettings: LoginDTO.loginSettings(settings.loginSettings),
			legal: LoginDTO.legal(settings.legal),
			passwordComplexity: LoginDTO.passwordComplexity(settings.passwordComplexity),
			identityProviders: LoginDTO.identityProviders(
				identityProviders.filter(
					(idp) => idp.options?.isAutoCreation || idp.options?.isCreationAllowed,
				),
			),
		} satisfies RegisterModel.Page.Response);
	},
);

router.get(
	"/password",

	APIRouteSpec.unauthenticated({
		summary: "Register password page",
		description: "Settings for choosing the password of a new account.",
		tags: [DOCS_TAGS.REGISTER],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", RegisterModel.PasswordPage.Response),
		),
	}),

	zValidator("query", RegisterModel.PasswordPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const settings = await loadRegistrationSettings(ctx, c.req.valid("query").organization);

		return APIResponse.success(c, "Page data loaded", {
			branding: settings.branding,
			organization: settings.organization,
			loginSettings: LoginDTO.loginSettings(settings.loginSettings),
			legal: LoginDTO.legal(settings.legal),
			passwordComplexity: LoginDTO.passwordComplexity(settings.passwordComplexity),
		} satisfies RegisterModel.PasswordPage.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Register",
		description:
			"Creates the user (with password, or without for a passkey) and a session, and returns the next step.",
		tags: [DOCS_TAGS.REGISTER],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("User registered", LoginModels.FlowStep),
			APIResponseSpec.badRequest("Could not register the user"),
		),
	}),

	zValidator("json", RegisterModel.Register.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		try {
			const result = await LoginRegister.registerUser(ctx, c.req.valid("json"));
			return LoginResponses.flow(c, "User registered", result);
		} catch (error) {
			Logger.error("Could not register user:", error);
			return APIResponse.badRequest(c, (await ctx.t("register"))("errors.couldNotRegisterUser"));
		}
	},
);

router.post(
	"/idp",

	APIRouteSpec.unauthenticated({
		summary: "Register with IdP",
		description: "Creates the user from a completed registration form, links the IdP and signs in.",
		tags: [DOCS_TAGS.REGISTER],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("User registered", LoginModels.FlowStep),
			APIResponseSpec.badRequest("Could not register user"),
		),
	}),

	zValidator("json", RegisterModel.RegisterWithIdp.Body),

	async (c) => {
		try {
			const result = await LoginRegister.registerUserAndLinkToIDP(
				LoginContext.from(c),
				c.req.valid("json"),
			);
			return LoginResponses.flow(c, "User registered", result);
		} catch (error) {
			Logger.error("Could not register user with IdP:", error);
			return APIResponse.badRequest(c, "Could not register user");
		}
	},
);
