import { Hono } from "hono";
import type { GenerateSpecOptions } from "hono-openapi";
import { AppConstants } from "../../../utils/constants";
import { APIVersionRouter } from "../../utils/apiVersionRouter";
import { DOCS_TAGS } from "./docs";
import { router as accountsRouter } from "./routes/accounts";
import { router as authenticatorRouter } from "./routes/authenticator";
import { router as deviceRouter } from "./routes/device";
import { router as flowRouter } from "./routes/flow";
import { router as idpRouter } from "./routes/idp";
import { router as loginnameRouter } from "./routes/loginname";
import { router as logoutRouter } from "./routes/logout";
import { router as mfaRouter } from "./routes/mfa";
import { router as otpRouter } from "./routes/otp";
import { router as passkeyRouter } from "./routes/passkey";
import { router as passwordRouter } from "./routes/password";
import { router as registerRouter } from "./routes/register";
import { router as sessionRouter } from "./routes/session";
import { router as settingsRouter } from "./routes/settings";
import { router as signedinRouter } from "./routes/signedin";
import { router as u2fRouter } from "./routes/u2f";
import { router as verifyRouter } from "./routes/verify";

const TAG_GROUPS = [
	{
		name: "Login",
		tags: [
			DOCS_TAGS.LOGIN_NAME,
			DOCS_TAGS.ACCOUNTS,
			DOCS_TAGS.PASSWORD,
			DOCS_TAGS.PASSKEY,
			DOCS_TAGS.U2F,
			DOCS_TAGS.OTP,
			DOCS_TAGS.MFA,
			DOCS_TAGS.AUTHENTICATOR,
			DOCS_TAGS.SESSION,
			DOCS_TAGS.FLOW,
			DOCS_TAGS.SIGNED_IN,
			DOCS_TAGS.LOGOUT,
		],
	},
	{
		name: "Onboarding",
		tags: [DOCS_TAGS.REGISTER, DOCS_TAGS.VERIFY, DOCS_TAGS.IDP, DOCS_TAGS.DEVICE],
	},
	{
		name: "General",
		tags: [DOCS_TAGS.SETTINGS],
	},
];

const openAPIConfig: Partial<GenerateSpecOptions> = {
	documentation: {
		info: {
			title: `${AppConstants.APP_NAME} API`,
			version: "1.0.0",
			description:
				`Backend of the ${AppConstants.APP_NAME} frontend: page data and login steps of the Zitadel ` +
				`Login V2 flows (port of zitadel/apps/login ${AppConstants.ZITADEL_VERSION}). The login state lives ` +
				"in httpOnly cookies (`sessions`), so all endpoints are cookie-authenticated and same-origin.",
		},

		servers: [
			{
				url: `http://localhost:${AppConstants.APP_API_DEFAULT_PORT}${AppConstants.DEFAULT_BASE_PATH}/api/v1`,
				description: "Local development server",
			},
			{
				url: `${AppConstants.APP_API_DEFAULT_PROD_URL}/v1`,
				description: "Production server",
			},
		],

		// Scalar groups the sidebar by these (OpenAPI vendor extension, not in the typed document).
		...({ "x-tagGroups": TAG_GROUPS } as Record<string, unknown>),

		tags: [
			{
				name: DOCS_TAGS.SETTINGS,
				description: "Branding and translations of the instance / organization",
			},
			{ name: DOCS_TAGS.LOGIN_NAME, description: "User discovery (the first login step)" },
			{ name: DOCS_TAGS.ACCOUNTS, description: "Accounts of this browser" },
			{ name: DOCS_TAGS.PASSWORD, description: "Password check, reset, set and change" },
			{ name: DOCS_TAGS.PASSKEY, description: "Passkey login and registration" },
			{ name: DOCS_TAGS.U2F, description: "Security keys as second factor" },
			{ name: DOCS_TAGS.OTP, description: "One-time passwords (TOTP, email, SMS)" },
			{ name: DOCS_TAGS.MFA, description: "Choosing and setting up second factors" },
			{ name: DOCS_TAGS.AUTHENTICATOR, description: "Setting up the first authenticator" },
			{ name: DOCS_TAGS.SESSION, description: "Challenges and checks on the login session" },
			{ name: DOCS_TAGS.FLOW, description: "Completing OIDC / SAML / device requests" },
			{ name: DOCS_TAGS.REGISTER, description: "Self-registration" },
			{ name: DOCS_TAGS.VERIFY, description: "Email and invite verification" },
			{ name: DOCS_TAGS.SIGNED_IN, description: "The signed-in page" },
			{ name: DOCS_TAGS.LOGOUT, description: "Ending sessions" },
			{ name: DOCS_TAGS.DEVICE, description: "OAuth device authorization" },
			{ name: DOCS_TAGS.IDP, description: "External identity providers (incl. LDAP)" },
		],
	},
};

const router = new Hono();

router.route("/", settingsRouter);
router.route("/", loginnameRouter);
router.route("/", accountsRouter);
router.route("/", passwordRouter);
router.route("/", passkeyRouter);
router.route("/", u2fRouter);
router.route("/", otpRouter);
router.route("/", mfaRouter);
router.route("/", authenticatorRouter);
router.route("/", sessionRouter);
router.route("/", flowRouter);
router.route("/", registerRouter);
router.route("/", verifyRouter);
router.route("/", signedinRouter);
router.route("/", logoutRouter);
router.route("/", deviceRouter);
router.route("/", idpRouter);

export class APIv1Router extends APIVersionRouter {
	constructor() {
		super({
			version: 1,
			openAPIConfig,
			routes: router,
		});
	}
}
