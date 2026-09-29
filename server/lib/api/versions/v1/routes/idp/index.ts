import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginIdp } from "../../../../../login/idp";
import { LoginIdpIntent } from "../../../../../login/idpIntent";
import { Logger } from "../../../../../utils/logger";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { IdpModel } from "./model";

export const router = new Hono().basePath("/idp");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Identity provider page",
		description: "The active identity providers of the organization.",
		tags: [DOCS_TAGS.IDP],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", IdpModel.Page.Response),
		),
	}),

	zValidator("query", IdpModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { organization } = c.req.valid("query");

		const [idps, branding] = await Promise.all([
			ZitadelAPI.getActiveIdentityProviders({ serviceConfig: ctx.serviceConfig, orgId: organization }),
			PageHelpers.branding(ctx, organization),
		]);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			identityProviders: LoginDTO.identityProviders(idps.identityProviders),
		} satisfies IdpModel.Page.Response);
	},
);

router.get(
	"/ldap",

	APIRouteSpec.unauthenticated({
		summary: "LDAP page",
		description: "Branding for the LDAP username/password form.",
		tags: [DOCS_TAGS.IDP],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", IdpModel.LdapPage.Response),
		),
	}),

	zValidator("query", IdpModel.LdapPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { idpId, organization } = c.req.valid("query");

		if (!idpId) {
			return APIResponse.badRequest(c, "No idpId provided in searchParams");
		}

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, organization ?? defaultOrganization),
		} satisfies IdpModel.LdapPage.Response);
	},
);

router.get(
	"/failure",

	APIRouteSpec.unauthenticated({
		summary: "IdP failure page",
		description: "Alternative authentication methods of the user after a failed IdP login.",
		tags: [DOCS_TAGS.IDP],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", IdpModel.FailurePage.Response),
		),
	}),

	zValidator("query", IdpModel.FailurePage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const serviceConfig = ctx.serviceConfig;
		const { organization, userId } = c.req.valid("query");

		const [branding, loginSettings] = await Promise.all([
			PageHelpers.branding(ctx, organization),
			ZitadelAPI.getLoginSettings({ serviceConfig, organization }),
		]);

		const params = new URLSearchParams({});
		if (organization) params.set("organization", organization);
		if (userId) params.set("userId", userId);

		let user: IdpModel.FailurePage.Response["user"] = null;
		let authMethods: LoginModels.AuthMethod[] = [];

		if (userId) {
			const found = (await ZitadelAPI.getUserByID({ serviceConfig, userId }).catch(() => undefined))
				?.user;
			if (found) {
				if (found.type.case === "human") {
					user = {
						loginName: found.preferredLoginName,
						displayName: found.type.value.profile?.displayName,
					};
				}
				if (found.preferredLoginName) params.set("loginName", found.preferredLoginName);
			}

			const methods = await ZitadelAPI.listAuthenticationMethodTypes({ serviceConfig, userId }).catch(
				() => undefined,
			);
			authMethods = LoginDTO.authMethods(methods?.authMethodTypes);
		}

		return APIResponse.success(c, "Page data loaded", {
			branding,
			loginSettings: LoginDTO.loginSettings(loginSettings),
			user,
			authMethods,
			params: params.toString(),
		} satisfies IdpModel.FailurePage.Response);
	},
);

router.post(
	"/start",

	APIRouteSpec.unauthenticated({
		summary: "Start IdP login",
		description: "Starts the IdP flow (redirect or form post), or leads to the LDAP form.",
		tags: [DOCS_TAGS.IDP],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("IdP flow started", LoginModels.FlowStep),
			APIResponseSpec.badRequest("Could not start IDP flow"),
		),
	}),

	zValidator("json", IdpModel.Start.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		try {
			const result = await LoginIdp.redirectToIdp(ctx, c.req.valid("json"));
			return LoginResponses.flow(c, "IdP flow started", result);
		} catch (error) {
			Logger.error("Could not start IdP flow:", error);
			return APIResponse.badRequest(c, "Could not start IDP flow");
		}
	},
);

router.post(
	"/ldap",

	APIRouteSpec.unauthenticated({
		summary: "LDAP login",
		description: "Authenticates at the LDAP IdP and continues with its intent.",
		tags: [DOCS_TAGS.IDP],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("LDAP login started", LoginModels.FlowStep),
			APIResponseSpec.badRequest("Could not start LDAP flow"),
		),
	}),

	zValidator("json", IdpModel.Ldap.Body),

	async (c) => {
		try {
			const result = await LoginIdp.createNewSessionForLDAP(LoginContext.from(c), c.req.valid("json"));
			return LoginResponses.flow(c, "LDAP login started", result);
		} catch (error) {
			Logger.warn("Could not start LDAP flow:", error);
			return APIResponse.badRequest(c, "Could not start LDAP flow");
		}
	},
);

router.post(
	"/process",

	APIRouteSpec.unauthenticated({
		summary: "Process IdP callback",
		description:
			"Consumes the IdP intent once and signs in, links, creates or asks to register the user.",
		tags: [DOCS_TAGS.IDP],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("IdP callback processed", LoginModels.FlowStep),
			APIResponseSpec.badRequest("The IdP callback could not be processed"),
		),
	}),

	zValidator("json", IdpModel.Process.Body),

	async (c) => {
		const { linkToSessionId, ...body } = c.req.valid("json");
		const result = await LoginIdpIntent.processIDPCallback(LoginContext.from(c), {
			...body,
			sessionId: linkToSessionId,
		});
		return LoginResponses.flow(c, "IdP callback processed", result);
	},
);
