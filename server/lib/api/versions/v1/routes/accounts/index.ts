import { create } from "@bufbuild/protobuf";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { SessionCookies } from "../../../../../login/cookies";
import { LoginSessions } from "../../../../../login/session";
import {
	type Session,
	SessionSchema,
} from "../../../../../zitadel/proto/zitadel/session/v2/session_pb";
import { APIResponse } from "../../../../utils/api-res";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { AccountsModel } from "./model";

export const router = new Hono().basePath("/accounts");

/**
 * Sessions of the cookie. Expired entries are deliberately kept, and entries whose server-side
 * session is gone (e.g. after an RP-initiated logout) are listed as invalid accounts, so the user
 * can re-authenticate with one click (like Login V1).
 */
async function loadSessions(ctx: LoginContext, organization?: string): Promise<Session[]> {
	const sessionCookies = SessionCookies.getAll(ctx);
	if (!sessionCookies.length) return [];

	// listSessions is a search: unknown ids are simply absent. Transport failures surface.
	const liveSessions = await LoginSessions.listFromCookies(
		ctx,
		sessionCookies.map((s) => s.id),
	);

	const liveIds = new Set(liveSessions.map((s) => s.id));
	const synthesized = sessionCookies
		.filter((c) => !!c.id && !!c.loginName && !liveIds.has(c.id))
		.map((c) =>
			create(SessionSchema, {
				id: c.id,
				// no displayName: the cookie has none, and reusing the loginName would show it twice
				factors: { user: { loginName: c.loginName, organizationId: c.organization ?? "" } },
			}),
		);

	let sessions = [...liveSessions, ...synthesized];
	if (organization) {
		sessions = sessions.filter((s) => s.factors?.user?.organizationId === organization);
	}
	return sessions;
}

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Accounts page",
		description: "The accounts (sessions) of this browser, filtered by organization.",
		tags: [DOCS_TAGS.ACCOUNTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", AccountsModel.Page.Response),
		),
	}),

	zValidator("query", AccountsModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { organization } = c.req.valid("query");

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);
		const sessions = await loadSessions(ctx, organization);

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, organization ?? defaultOrganization),
			sessions: sessions.map(LoginDTO.session),
		} satisfies AccountsModel.Page.Response);
	},
);
