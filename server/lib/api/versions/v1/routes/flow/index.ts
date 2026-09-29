import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginFlow } from "../../../../../login/flow";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { FlowModel } from "./model";

export const router = new Hono().basePath("/flow");

router.post(
	"/complete",

	APIRouteSpec.unauthenticated({
		summary: "Complete flow",
		description:
			"Completes the OIDC/SAML request with the session of the cookie (sessionId + requestId), hands device requests to the signed-in page, or resolves the default redirect (loginName).",
		tags: [DOCS_TAGS.FLOW],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Flow completed", LoginModels.FlowStep),
			APIResponseSpec.badRequest("The flow could not be completed"),
		),
	}),

	zValidator("json", FlowModel.Complete.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { sessionId, requestId, loginName, organization } = c.req.valid("json");

		// the default redirect comes from the organization's settings, never from the client
		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig: ctx.serviceConfig,
			organization,
		});

		if (requestId && sessionId) {
			const result = await LoginFlow.completeFlowOrGetUrl(
				ctx,
				{ sessionId, requestId, organization },
				loginSettings?.defaultRedirectUri,
			);
			return LoginResponses.flow(c, "Flow completed", result);
		}
		if (loginName) {
			const result = await LoginFlow.completeFlowOrGetUrl(
				ctx,
				{ loginName, organization },
				loginSettings?.defaultRedirectUri,
			);
			return LoginResponses.flow(c, "Flow completed", result);
		}

		return APIResponse.badRequest(c, "Either sessionId and requestId or loginName must be provided");
	},
);
