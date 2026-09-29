import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginSecurity } from "../../../../../login/security";
import { LoginSessions } from "../../../../../login/session";
import { LoginVerify } from "../../../../../login/verify";
import { Logger } from "../../../../../utils/logger";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { OTPModel } from "./model";

export const router = new Hono().basePath("/otp");

router.post(
	"/totp/verify",

	APIRouteSpec.unauthenticated({
		summary: "Verify TOTP registration",
		description:
			"Confirms a new authenticator app with its first code (needs an authorized session).",
		tags: [DOCS_TAGS.OTP],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Authenticator app verified"),
			APIResponseSpec.badRequest("The code could not be verified"),
		),
	}),

	zValidator("json", OTPModel.VerifyTOTP.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { code, loginName, organization } = c.req.valid("json");
		try {
			const result = await LoginVerify.verifyTOTP(ctx, code, loginName, organization);
			return LoginResponses.done(c, "Authenticator app verified", result);
		} catch (error) {
			Logger.warn("Could not verify TOTP registration:", error);
			const t = await ctx.t("otp");
			return APIResponse.badRequest(
				c,
				error instanceof Error && error.message ? error.message : t("errors.couldNotVerifyCode"),
			);
		}
	},
);

router.get(
	"/:method",

	APIRouteSpec.unauthenticated({
		summary: "OTP page",
		description: "The session and login settings for a one-time password check.",
		tags: [DOCS_TAGS.OTP],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", OTPModel.Page.Response),
		),
	}),

	zValidator("param", OTPModel.Params),
	zValidator("query", OTPModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, sessionId, organization } = c.req.valid("query");

		const session = sessionId
			? await LoginSessions.loadById(ctx, sessionId, organization).catch(() => undefined)
			: await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		// email links carry no organization: use the session's
		const org = organization ?? session?.factors?.user?.organizationId;

		const [branding, loginSettings] = await Promise.all([
			PageHelpers.branding(ctx, org),
			ZitadelAPI.getLoginSettings({ serviceConfig: ctx.serviceConfig, organization: org }),
		]);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: LoginDTO.optionalSession(session),
			loginSettings: LoginDTO.loginSettings(loginSettings),
		} satisfies OTPModel.Page.Response);
	},
);

router.post(
	"/:method/set",

	APIRouteSpec.unauthenticated({
		summary: "Set up OTP",
		description:
			"Registers TOTP (returns the secret) or adds OTP via email/SMS for an authorized session, and returns where to continue.",
		tags: [DOCS_TAGS.OTP],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("OTP setup started", OTPModel.Set.Response),
			APIResponseSpec.badRequest("No session found"),
		),
	}),

	zValidator("param", OTPModel.Params),
	zValidator("json", OTPModel.Set.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const serviceConfig = ctx.serviceConfig;
		const { method } = c.req.valid("param");
		const { loginName, organization, sessionId, requestId, checkAfter } = c.req.valid("json");

		const [branding, loginSettings] = await Promise.all([
			PageHelpers.branding(ctx, organization),
			ZitadelAPI.getLoginSettings({ serviceConfig, organization }),
		]);

		const session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });
		if (!session?.factors?.user?.id) {
			return APIResponse.badRequest(c, "No session found");
		}

		let totp: OTPModel.Set.Response["totp"];
		let error: string | undefined;

		// An identify-only session must not attach a new factor (GHSA-45f2-5q3r-xgg6).
		const enrollmentError = await LoginSecurity.getEnrollmentAuthorizationError(ctx, {
			serviceConfig,
			session,
			userId: session.factors.user.id,
		});

		if (enrollmentError) {
			error = enrollmentError;
		} else if (method === "time-based") {
			try {
				const resp = await ZitadelAPI.registerTOTP({ serviceConfig, userId: session.factors.user.id });
				totp = { uri: resp.uri, secret: resp.secret };
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
			}
		} else if (method === "sms") {
			await ZitadelAPI.addOTPSMS({ serviceConfig, userId: session.factors.user.id }).catch((err) =>
				Logger.warn("Could not add OTP via SMS", err),
			);
		} else if (method === "email") {
			await ZitadelAPI.addOTPEmail({ serviceConfig, userId: session.factors.user.id }).catch((err) =>
				Logger.warn("Could not add OTP via Email", err),
			);
		}

		const params = new URLSearchParams({});
		let continueUrl = "/accounts";
		let redirect: string | undefined;

		if (sessionId) params.append("sessionId", sessionId);
		if (loginName) params.append("loginName", loginName);
		if (organization) params.append("organization", organization);

		if (checkAfter) {
			if (requestId) params.append("requestId", requestId);
			continueUrl = `/otp/${method}?${params}`;
			// check email/SMS directly on the next page
			if (method === "email" || method === "sms") redirect = continueUrl;
		} else if (requestId && sessionId) {
			// The Zitadel login appends `authRequest=<requestId>` here, which /login prefixes a second
			// time (`oidc_oidc_…`); `requestId` is taken as-is.
			params.append("requestId", requestId);
			continueUrl = `/login?${params}`;
		} else if (loginName) {
			if (requestId) params.append("requestId", requestId);
			continueUrl = `/signedin?${params}`;
		}

		return APIResponse.success(c, "OTP setup started", {
			branding,
			session: LoginDTO.session(session),
			loginSettings: LoginDTO.loginSettings(loginSettings),
			totp,
			error,
			continueUrl,
			redirect,
		} satisfies OTPModel.Set.Response);
	},
);
