import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { SessionCookies } from "../../../../../login/cookies";
import { LoginLogout } from "../../../../../login/logout";
import { LoginSessions } from "../../../../../login/session";
import { APIResponse } from "../../../../utils/api-res";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { LogoutModel } from "./model";

export const router = new Hono().basePath("/logout");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Logout page",
		description:
			"The sessions of this browser, plus redirect and hint from the verified `logout_token` (RP-initiated logout).",
		tags: [DOCS_TAGS.LOGOUT],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", LogoutModel.Page.Response),
		),
	}),

	zValidator("query", LogoutModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { organization, logout_token } = c.req.valid("query");

		const { postLogoutRedirectUri, logoutHint } = logout_token
			? await LoginLogout.verifyLogoutToken(ctx.serviceConfig, logout_token)
			: {};

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);
		const sessions = await LoginSessions.listFromCookies(ctx, SessionCookies.getAllIds(ctx));

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, organization ?? defaultOrganization),
			sessions: sessions.map(LoginDTO.session),
			postLogoutRedirectUri,
			logoutHint,
			organization: organization ?? defaultOrganization,
		} satisfies LogoutModel.Page.Response);
	},
);
