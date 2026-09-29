import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginCookies } from "../../../../../login/cookies";
import { LoginSessions } from "../../../../../login/session";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { AuthenticatorModel } from "./model";

export const router = new Hono().basePath("/authenticator");

router.get(
	"/set",

	APIRouteSpec.unauthenticated({
		summary: "Authenticator setup page",
		description:
			"Choosing the first authenticator (password, passkey, IdP) after an email / invite verification in this browser.",
		tags: [DOCS_TAGS.AUTHENTICATOR],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", AuthenticatorModel.SetPage.Response),
		),
	}),

	zValidator("query", AuthenticatorModel.SetPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const serviceConfig = ctx.serviceConfig;
		const { loginName, requestId, organization, sessionId } = c.req.valid("query");

		const session = sessionId
			? await LoginSessions.loadById(ctx, sessionId, organization).catch(() => undefined)
			: await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		const user = session?.factors?.user;
		if (!session || !user?.id) {
			return APIResponse.success(c, "Page data loaded", {
				error: loginName || sessionId ? "sessionExpired" : "unknownContext",
				branding: null,
				session: null,
				authMethods: [],
				loginSettings: null,
				identityProviders: [],
				setupParams: "",
			} satisfies AuthenticatorModel.SetPage.Response);
		}

		const [methods, branding, loginSettings] = await Promise.all([
			ZitadelAPI.listAuthenticationMethodTypes({ serviceConfig, userId: user.id }),
			PageHelpers.branding(ctx, user.organizationId),
			ZitadelAPI.getLoginSettings({ serviceConfig, organization: user.organizationId }),
		]);

		// the user must have verified their email / invite recently in this browser
		if (!LoginCookies.checkUserVerification(ctx, user.id)) {
			const params = new URLSearchParams({
				loginName: user.loginName,
				invite: "true",
				send: "true", // request a new code immediately
			});
			if (requestId) params.append("requestId", requestId);
			if (organization || user.organizationId) {
				params.append("organization", organization ?? user.organizationId);
			}
			return APIResponse.success(c, "Page data loaded", {
				redirect: `/verify?${params}`,
				branding,
				session: LoginDTO.session(session),
				authMethods: [],
				loginSettings: null,
				identityProviders: [],
				setupParams: "",
			} satisfies AuthenticatorModel.SetPage.Response);
		}

		const { identityProviders } = await ZitadelAPI.getActiveIdentityProviders({
			serviceConfig,
			orgId: user.organizationId,
			linking_allowed: true,
		});

		const setupParams = new URLSearchParams({
			initial: "true", // no code required, not shown in the UI
		});
		if (user.loginName) setupParams.set("loginName", user.loginName);
		if (user.organizationId) setupParams.set("organization", user.organizationId);
		if (requestId) setupParams.set("requestId", requestId);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: LoginDTO.session(session),
			authMethods: LoginDTO.authMethods(methods.authMethodTypes),
			loginSettings: LoginDTO.loginSettings(loginSettings),
			identityProviders: LoginDTO.identityProviders(identityProviders),
			setupParams: setupParams.toString(),
		} satisfies AuthenticatorModel.SetPage.Response);
	},
);
