import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginSecurity } from "../../../../../login/security";
import { LoginSessions } from "../../../../../login/session";
import { LoginU2F } from "../../../../../login/u2f";
import { Logger } from "../../../../../utils/logger";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { U2FModel } from "./model";

export const router = new Hono().basePath("/u2f");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Security key page",
		description: "The session (by id or login name) for a security-key check.",
		tags: [DOCS_TAGS.U2F],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", U2FModel.Page.Response),
		),
	}),

	zValidator("query", U2FModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, sessionId, organization } = c.req.valid("query");

		const session = sessionId
			? await LoginSessions.loadById(ctx, sessionId, organization).catch(() => undefined)
			: await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, organization),
			session: LoginDTO.optionalSession(session),
		} satisfies U2FModel.Page.Response);
	},
);

router.get(
	"/set",

	APIRouteSpec.unauthenticated({
		summary: "Security key setup page",
		description: "The session and whether it may register a security key.",
		tags: [DOCS_TAGS.U2F],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", U2FModel.SetPage.Response),
		),
	}),

	zValidator("query", U2FModel.SetPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, organization } = c.req.valid("query");

		const session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		// defense in depth alongside the registration endpoints (GHSA-45f2-5q3r-xgg6)
		let enrollmentAuthorized = false;
		if (session?.id && session.factors?.user?.id) {
			const enrollmentError = await LoginSecurity.getEnrollmentAuthorizationError(ctx, {
				serviceConfig: ctx.serviceConfig,
				session,
				userId: session.factors.user.id,
			});
			enrollmentAuthorized = !enrollmentError;
		}

		const [branding, loginSettings] = await Promise.all([
			PageHelpers.branding(ctx, organization),
			ZitadelAPI.getLoginSettings({ serviceConfig: ctx.serviceConfig, organization }),
		]);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: LoginDTO.optionalSession(session),
			enrollmentAuthorized,
			loginSettings: LoginDTO.loginSettings(loginSettings),
		} satisfies U2FModel.SetPage.Response);
	},
);

router.post(
	"/registration",

	APIRouteSpec.unauthenticated({
		summary: "Start security key registration",
		description: "Returns the WebAuthn creation options for an authorized session.",
		tags: [DOCS_TAGS.U2F],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Security key registration started", U2FModel.Registration.Response),
			APIResponseSpec.badRequest("An error on registering passkey"),
		),
	}),

	zValidator("json", U2FModel.Registration.Body),

	async (c) => {
		const result = await LoginU2F.addU2F(LoginContext.from(c), c.req.valid("json"));
		if ("error" in result) {
			return APIResponse.badRequest(c, result.error ?? "An error on registering passkey");
		}
		if (!result.u2fId || !result.publicKeyCredentialCreationOptions) {
			return APIResponse.badRequest(c, "An error on registering passkey");
		}
		return APIResponse.success(c, "Security key registration started", {
			u2fId: result.u2fId,
			publicKeyCredentialCreationOptions: result.publicKeyCredentialCreationOptions,
		} satisfies U2FModel.Registration.Response);
	},
);

router.post(
	"/registration/verify",

	APIRouteSpec.unauthenticated({
		summary: "Finish security key registration",
		description: "Verifies the created credential and adds the security key to the user.",
		tags: [DOCS_TAGS.U2F],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Security key registered"),
			APIResponseSpec.badRequest("An error on verifying passkey occurred"),
		),
	}),

	zValidator("json", U2FModel.VerifyRegistration.Body),

	async (c) => {
		try {
			const result = await LoginU2F.verifyU2F(LoginContext.from(c), c.req.valid("json"));
			if ("error" in result && typeof result.error === "string") {
				return APIResponse.badRequest(c, result.error);
			}
			return APIResponse.successNoData(c, "Security key registered");
		} catch (error) {
			Logger.warn("Could not verify security key registration:", error);
			return APIResponse.badRequest(c, "An error on verifying passkey occurred");
		}
	},
);
