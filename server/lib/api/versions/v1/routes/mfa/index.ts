import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginSessions } from "../../../../../login/session";
import { LoginSessionActions } from "../../../../../login/sessionActions";
import { ZitadelAPI } from "../../../../../zitadel/api";
import type { Session } from "../../../../../zitadel/proto/zitadel/session/v2/session_pb";
import { SecondFactorType } from "../../../../../zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { MFAModel } from "./model";

export const router = new Hono().basePath("/mfa");

async function loadSession(
	ctx: LoginContext,
	{
		sessionId,
		loginName,
		organization,
	}: { sessionId?: string; loginName?: string; organization?: string },
): Promise<Session | undefined> {
	if (sessionId) {
		return LoginSessions.loadById(ctx, sessionId, organization).catch(() => undefined);
	}
	return LoginSessions.loadMostRecent(ctx, { loginName, organization });
}

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Second factor page",
		description: "The session and the user's configured authentication methods.",
		tags: [DOCS_TAGS.MFA],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", MFAModel.Page.Response),
		),
	}),

	zValidator("query", MFAModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const query = c.req.valid("query");

		const session = await loadSession(ctx, query);
		const authMethods = session?.factors?.user?.id
			? (
					await ZitadelAPI.listAuthenticationMethodTypes({
						serviceConfig: ctx.serviceConfig,
						userId: session.factors.user.id,
					})
				).authMethodTypes
			: [];

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, query.organization),
			session: session?.factors?.user?.id ? LoginDTO.session(session) : null,
			authMethods: LoginDTO.authMethods(authMethods),
		} satisfies MFAModel.Page.Response);
	},
);

router.get(
	"/set",

	APIRouteSpec.unauthenticated({
		summary: "Second factor setup page",
		description:
			"The session, its user's methods and verified channels, and the allowed second factors.",
		tags: [DOCS_TAGS.MFA],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", MFAModel.SetPage.Response),
		),
	}),

	zValidator("query", MFAModel.SetPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const serviceConfig = ctx.serviceConfig;
		const query = c.req.valid("query");
		const { force, requestId, organization } = query;

		const session = await loadSession(ctx, query);
		const userId = session?.factors?.user?.id;

		let authMethods: LoginModels.AuthMethod[] = [];
		let phoneVerified = false;
		let emailVerified = false;
		if (userId) {
			const [methods, user] = await Promise.all([
				ZitadelAPI.listAuthenticationMethodTypes({ serviceConfig, userId }),
				ZitadelAPI.getUserByID({ serviceConfig, userId }),
			]);
			const humanUser = user.user?.type.case === "human" ? user.user.type.value : undefined;
			authMethods = LoginDTO.authMethods(methods.authMethodTypes);
			phoneVerified = humanUser?.phone?.isVerified ?? false;
			emailVerified = humanUser?.email?.isVerified ?? false;
		}

		const [branding, loginSettings] = await Promise.all([
			PageHelpers.branding(ctx, organization),
			ZitadelAPI.getLoginSettings({
				serviceConfig,
				organization: session?.factors?.user?.organizationId,
			}),
		]);

		const { valid } =
			session && userId ? LoginSessions.hasVerifiedPrimaryFactor(session) : { valid: false };

		let redirect: string | undefined;
		if (force === "true" && valid && session?.factors?.user?.loginName && loginSettings) {
			const hasVisibleFactor = loginSettings.secondFactors.some((f) => {
				switch (f) {
					case SecondFactorType.OTP:
					case SecondFactorType.U2F:
						return true;
					case SecondFactorType.OTP_EMAIL:
						return emailVerified;
					case SecondFactorType.OTP_SMS:
						return phoneVerified;
					default:
						return false;
				}
			});

			if (
				!hasVisibleFactor &&
				!emailVerified &&
				loginSettings.secondFactors.includes(SecondFactorType.OTP_EMAIL)
			) {
				const params = new URLSearchParams({ loginName: session.factors.user.loginName, send: "true" });
				const org = organization ?? session.factors.user.organizationId;
				if (requestId) params.set("requestId", requestId);
				if (org) params.set("organization", org);
				redirect = `/verify?${params}`;
			}
		}

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: userId && session ? LoginDTO.session(session) : null,
			valid,
			authMethods,
			phoneVerified,
			emailVerified,
			loginSettings: LoginDTO.loginSettings(loginSettings),
			redirect,
		} satisfies MFAModel.SetPage.Response);
	},
);

router.post(
	"/skip",

	APIRouteSpec.unauthenticated({
		summary: "Skip second factor setup",
		description: "Records that the user skipped the (optional) MFA setup and continues the flow.",
		tags: [DOCS_TAGS.MFA],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("MFA setup skipped", LoginModels.FlowStep),
			APIResponseSpec.badRequest("Could not skip MFA and continue"),
		),
	}),

	zValidator("json", MFAModel.Skip.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const body = c.req.valid("json");

		// Only the authenticated user of this browser may skip for themselves (the Zitadel login
		// accepts any userId here).
		const session = await loadSession(ctx, body);
		if (
			!session ||
			session.factors?.user?.id !== body.userId ||
			!LoginSessions.hasVerifiedPrimaryFactor(session).valid
		) {
			return APIResponse.badRequest(c, "Could not skip MFA and continue");
		}

		const result = await LoginSessionActions.skipMFAAndContinueWithNextUrl(ctx, body);
		return LoginResponses.flow(c, "MFA setup skipped", result);
	},
);
