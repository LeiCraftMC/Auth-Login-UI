import { create } from "@bufbuild/protobuf";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginPassword } from "../../../../../login/password";
import { LoginSessions } from "../../../../../login/session";
import { UNKNOWN_USER_ID } from "../../../../../login/types";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { ChecksSchema } from "../../../../../zitadel/proto/zitadel/session/v2/session_service_pb";
import type { User } from "../../../../../zitadel/proto/zitadel/user/v2/user_pb";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PasswordModel } from "./model";

export const router = new Hono().basePath("/password");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Password page",
		description:
			"The session of the login name (none under enumeration protection is fine) and the login settings.",
		tags: [DOCS_TAGS.PASSWORD],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", PasswordModel.Page.Response),
		),
	}),

	zValidator("query", PasswordModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, organization } = c.req.valid("query");

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);

		// no session is fine (ignoreUnknownUsernames)
		const session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });
		const org = organization ?? session?.factors?.user?.organizationId ?? defaultOrganization;

		const [branding, loginSettings] = await Promise.all([
			PageHelpers.branding(ctx, org),
			ZitadelAPI.getLoginSettings({ serviceConfig: ctx.serviceConfig, organization: org }),
		]);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			loginSettings: LoginDTO.loginSettings(loginSettings),
			defaultOrganization,
			session: LoginDTO.optionalSession(session),
		} satisfies PasswordModel.Page.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Verify password",
		description:
			"Checks the password on the session and returns the next step (MFA, change, verification, done).",
		tags: [DOCS_TAGS.PASSWORD],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Password verified", LoginModels.FlowStep),
			APIResponseSpec.badRequest("The password could not be verified"),
		),
	}),

	zValidator("json", PasswordModel.Send.Body),

	async (c) => {
		const { password, ...command } = c.req.valid("json");
		const result = await LoginPassword.sendPassword(LoginContext.from(c), {
			...command,
			checks: create(ChecksSchema, { password: { password } }),
		});
		return LoginResponses.flow(c, "Password verified", result);
	},
);

router.post(
	"/reset",

	APIRouteSpec.unauthenticated({
		summary: "Request password reset",
		description:
			"Sends a password reset link (silently succeeds for unknown users under enumeration protection).",
		tags: [DOCS_TAGS.PASSWORD],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Password reset requested"),
			APIResponseSpec.badRequest("The reset link could not be sent"),
		),
	}),

	zValidator("json", PasswordModel.Reset.Body),

	async (c) => {
		const result = await LoginPassword.resetPassword(LoginContext.from(c), c.req.valid("json"));
		return LoginResponses.done(c, "Password reset requested", result);
	},
);

router.get(
	"/set",

	APIRouteSpec.unauthenticated({
		summary: "Set password page",
		description:
			"Resolves the user (by id or login name) and the complexity settings for setting a password.",
		tags: [DOCS_TAGS.PASSWORD],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", PasswordModel.SetPage.Response),
		),
	}),

	zValidator("query", PasswordModel.SetPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const serviceConfig = ctx.serviceConfig;
		const query = c.req.valid("query");
		const { loginName, organization, initial } = query;
		let { userId } = query;

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);

		// no session is fine (ignoreUnknownUsernames)
		const session = loginName
			? await LoginSessions.loadMostRecent(ctx, { loginName, organization })
			: undefined;

		const branding = await PageHelpers.branding(ctx, organization ?? defaultOrganization);
		const settingsOrg = organization ?? session?.factors?.user?.organizationId ?? defaultOrganization;

		const [passwordComplexity, loginSettings] = await Promise.all([
			ZitadelAPI.getPasswordComplexitySettings({ serviceConfig, organization: settingsOrg }),
			ZitadelAPI.getLoginSettings({ serviceConfig, organization: settingsOrg }),
		]);

		if (!loginSettings) {
			return APIResponse.success(c, "Page data loaded", {
				branding,
				error: "couldNotGetLoginSettings",
				defaultOrganization,
				session: LoginDTO.optionalSession(session),
				passwordComplexity: LoginDTO.passwordComplexity(passwordComplexity),
				form: null,
			} satisfies PasswordModel.SetPage.Response);
		}

		let user: User | undefined;
		if (userId) {
			user = (await ZitadelAPI.getUserByID({ serviceConfig, userId }).catch(() => undefined))?.user;
		} else if (loginName) {
			const users = await ZitadelAPI.searchUsers({
				serviceConfig,
				searchValue: loginName,
				loginSettings,
				organizationId: organization,
				t: await ctx.t("zitadel"),
			});

			if ("result" in users && users.result?.length === 1 && users.result[0]) {
				user = users.result[0];
				userId = user.userId;
			} else if (loginSettings.ignoreUnknownUsernames) {
				// prevent enumeration by pretending we found a user
				userId = UNKNOWN_USER_ID;
			}
		}

		const formLoginName = loginName ?? user?.preferredLoginName;
		const formUserId =
			userId ??
			session?.factors?.user?.id ??
			(loginSettings.ignoreUnknownUsernames ? UNKNOWN_USER_ID : undefined);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			defaultOrganization,
			session: LoginDTO.optionalSession(session),
			passwordComplexity: LoginDTO.passwordComplexity(passwordComplexity),
			form:
				passwordComplexity && formLoginName && formUserId
					? { userId: formUserId, loginName: formLoginName, codeRequired: !(initial === "true") }
					: null,
		} satisfies PasswordModel.SetPage.Response);
	},
);

router.post(
	"/set",

	APIRouteSpec.unauthenticated({
		summary: "Set password",
		description:
			"Sets the password with a code (reset / invite), or without one after a user verification for users without any authenticator.",
		tags: [DOCS_TAGS.PASSWORD],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Password set"),
			APIResponseSpec.badRequest("The password could not be set"),
		),
	}),

	zValidator("json", PasswordModel.Set.Body),

	async (c) => {
		const result = await LoginPassword.changePassword(LoginContext.from(c), c.req.valid("json"));
		return LoginResponses.done(c, "Password set", result);
	},
);

router.get(
	"/change",

	APIRouteSpec.unauthenticated({
		summary: "Change password page",
		description: "The session and complexity settings for a required password change.",
		tags: [DOCS_TAGS.PASSWORD],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", PasswordModel.ChangePage.Response),
		),
	}),

	zValidator("query", PasswordModel.ChangePage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, organization } = c.req.valid("query");

		const session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		const [branding, passwordComplexity] = await Promise.all([
			PageHelpers.branding(ctx, organization),
			ZitadelAPI.getPasswordComplexitySettings({
				serviceConfig: ctx.serviceConfig,
				organization: session?.factors?.user?.organizationId,
			}),
		]);

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: LoginDTO.optionalSession(session),
			passwordComplexity: LoginDTO.passwordComplexity(passwordComplexity),
		} satisfies PasswordModel.ChangePage.Response);
	},
);

router.post(
	"/change",

	APIRouteSpec.unauthenticated({
		summary: "Change password",
		description: "Re-checks the current password on the session and sets the new one.",
		tags: [DOCS_TAGS.PASSWORD],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Password changed"),
			APIResponseSpec.badRequest("The password could not be changed"),
		),
	}),

	zValidator("json", PasswordModel.Change.Body),

	async (c) => {
		const result = await LoginPassword.checkSessionAndSetPassword(
			LoginContext.from(c),
			c.req.valid("json"),
		);
		return LoginResponses.done(c, "Password changed", result);
	},
);
