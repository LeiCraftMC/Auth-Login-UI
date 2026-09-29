import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginSessions } from "../../../../../login/session";
import { UNKNOWN_USER_ID } from "../../../../../login/types";
import { LoginVerify } from "../../../../../login/verify";
import { ConfigHandler } from "../../../../../utils/config";
import { Logger } from "../../../../../utils/logger";
import { ZitadelAPI } from "../../../../../zitadel/api";
import type { LoginSettings } from "../../../../../zitadel/proto/zitadel/settings/v2/login_settings_pb";
import type { User } from "../../../../../zitadel/proto/zitadel/user/v2/user_pb";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { VerifyModel } from "./model";

export const router = new Hono().basePath("/verify");

function displayNameOf(user: User | undefined) {
	return user?.type.case === "human" ? user.type.value.profile?.displayName : undefined;
}

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Verify page",
		description:
			"Resolves the user to verify (by session, id or login name — a placeholder under enumeration protection).",
		tags: [DOCS_TAGS.VERIFY],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", VerifyModel.Page.Response),
		),
	}),

	zValidator("query", VerifyModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const serviceConfig = ctx.serviceConfig;
		const { userId, loginName, organization } = c.req.valid("query");
		// like the Zitadel login, the presence of the loginName parameter decides (even if empty)
		const hasLoginNameParam = c.req.query("loginName") !== undefined;

		const branding = await PageHelpers.branding(ctx, organization);

		let session: Awaited<ReturnType<typeof LoginSessions.loadMostRecent>>;
		let user: User | undefined;
		let loginSettings: LoginSettings | undefined;

		if (hasLoginNameParam) {
			session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });
		} else if (userId) {
			user = (await ZitadelAPI.getUserByID({ serviceConfig, userId }).catch(() => undefined))?.user;
		}

		let id = userId ?? session?.factors?.user?.id;

		if (!id && loginName) {
			loginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization });
			if (loginSettings) {
				const users = await ZitadelAPI.searchUsers({
					serviceConfig,
					searchValue: loginName,
					loginSettings,
					organizationId: organization,
					t: await ctx.t("zitadel"),
				});

				if ("result" in users && users.result?.length === 1 && users.result[0]) {
					user = users.result[0];
					id = user.userId;
				} else if (loginSettings.ignoreUnknownUsernames) {
					// prevent enumeration by pretending we found a user
					id = UNKNOWN_USER_ID;
				}
			} else {
				Logger.error("loginSettings not found");
			}
		}

		let avatar: VerifyModel.Page.Response["avatar"] = null;
		if (session) {
			avatar = {
				loginName: loginName ?? session.factors?.user?.loginName ?? "",
				displayName: session.factors?.user?.displayName,
				showDropdown: true,
			};
		} else if (user || loginName) {
			const avatarLoginName = loginName ?? user?.preferredLoginName ?? "";
			avatar = {
				loginName: avatarLoginName,
				// never reveal the real name while enumeration protection applies
				displayName: !loginSettings?.ignoreUnknownUsernames ? displayNameOf(user) : avatarLoginName,
				showDropdown: false,
			};
		}

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: LoginDTO.optionalSession(session),
			avatar,
			userId: id,
			autoSubmit: ConfigHandler.getConfig()?.AUTO_SUBMIT_CODE === true,
		} satisfies VerifyModel.Page.Response);
	},
);

router.get(
	"/success",

	APIRouteSpec.unauthenticated({
		summary: "Verification success page",
		description: "The verified user and, with a pending request, where to continue.",
		tags: [DOCS_TAGS.VERIFY],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Page data loaded", VerifyModel.SuccessPage.Response),
			APIResponseSpec.badRequest("Failed to get user id"),
		),
	}),

	zValidator("query", VerifyModel.SuccessPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, organization, userId, requestId } = c.req.valid("query");

		const branding = await PageHelpers.branding(ctx, organization);
		const session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });

		const id = userId ?? session?.factors?.user?.id;
		if (!id) {
			return APIResponse.badRequest(c, "Failed to get user id");
		}

		const user = (
			await ZitadelAPI.getUserByID({ serviceConfig: ctx.serviceConfig, userId: id }).catch(
				() => undefined,
			)
		)?.user;

		let continueUrl: string | undefined;
		if (requestId) {
			const params = new URLSearchParams();
			if (loginName || user?.preferredLoginName) {
				params.set("loginName", loginName ?? user?.preferredLoginName ?? "");
			}
			if (organization) params.set("organization", organization);
			params.set("requestId", requestId);
			continueUrl = `/loginname?${params}`;
		}

		return APIResponse.success(c, "Page data loaded", {
			branding,
			session: LoginDTO.optionalSession(session),
			avatar: session
				? {
						loginName: loginName ?? session.factors?.user?.loginName ?? "",
						displayName: session.factors?.user?.displayName,
						showDropdown: true,
					}
				: user
					? { loginName: user.preferredLoginName, displayName: displayNameOf(user), showDropdown: false }
					: null,
			continueUrl,
		} satisfies VerifyModel.SuccessPage.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Verify code",
		description:
			"Verifies the email / invite code and returns the next step (authenticator setup, MFA, done).",
		tags: [DOCS_TAGS.VERIFY],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Code verified", LoginModels.FlowStep),
			APIResponseSpec.badRequest("The code could not be verified"),
		),
	}),

	zValidator("json", VerifyModel.Send.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		try {
			const result = await LoginVerify.sendVerification(ctx, c.req.valid("json"));
			return LoginResponses.flow(c, "Code verified", result);
		} catch (error) {
			Logger.error("Could not verify user:", error);
			return APIResponse.badRequest(c, (await ctx.t("verify"))("errors.couldNotVerifyUser"));
		}
	},
);

router.post(
	"/resend",

	APIRouteSpec.unauthenticated({
		summary: "Resend code",
		description: "Sends a new email verification / invite code.",
		tags: [DOCS_TAGS.VERIFY],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Code sent"),
			APIResponseSpec.badRequest("The code could not be sent"),
		),
	}),

	zValidator("json", VerifyModel.Resend.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const body = c.req.valid("json");

		// never send for the enumeration placeholder; pretend it worked
		if (body.userId === UNKNOWN_USER_ID) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			return APIResponse.successNoData(c, "Code sent");
		}

		try {
			const result = await LoginVerify.resendVerification(ctx, body);
			return LoginResponses.done(c, "Code sent", result);
		} catch (error) {
			Logger.warn("Could not resend verification:", error);
			return APIResponse.badRequest(c, (await ctx.t("verify"))("errors.couldNotResendEmail"));
		}
	},
);
