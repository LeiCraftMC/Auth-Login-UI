import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginFlow } from "../../../../../login/flow";
import { LoginSessions } from "../../../../../login/session";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { SignedInModel } from "./model";

export const router = new Hono().basePath("/signedin");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Signed-in page",
		description: 'The signed-in session and where "continue" leads (default redirect).',
		tags: [DOCS_TAGS.SIGNED_IN],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", SignedInModel.Page.Response),
		),
	}),

	zValidator("query", SignedInModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, requestId, organization, sessionId } = c.req.valid("query");

		const branding = await PageHelpers.branding(ctx, organization);

		const session = sessionId
			? await LoginSessions.loadById(ctx, sessionId, organization).catch(() => undefined)
			: await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		const loginSettings = requestId
			? undefined
			: await ZitadelAPI.getLoginSettings({ serviceConfig: ctx.serviceConfig, organization });

		const redirectUri = LoginFlow.resolveRedirectUri(
			ctx,
			requestId && sessionId
				? { sessionId, requestId }
				: { loginName: loginName ?? session?.factors?.user?.loginName ?? "" },
			loginSettings?.defaultRedirectUri,
		);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: LoginDTO.optionalSession(session),
			redirectUri: redirectUri.startsWith("/signedin") ? undefined : redirectUri,
		} satisfies SignedInModel.Page.Response);
	},
);
