import { create } from "@bufbuild/protobuf";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginPasskeys } from "../../../../../login/passkeys";
import { LoginSessions } from "../../../../../login/session";
import { Logger } from "../../../../../utils/logger";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { ChecksSchema } from "../../../../../zitadel/proto/zitadel/session/v2/session_service_pb";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PasskeyModel } from "./model";

export const router = new Hono().basePath("/passkey");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Passkey page",
		description: "The session (by id or login name) for a passkey login.",
		tags: [DOCS_TAGS.PASSKEY],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", PasskeyModel.Page.Response),
		),
	}),

	zValidator("query", PasskeyModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { loginName, organization, sessionId } = c.req.valid("query");

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);

		let session = sessionId
			? await LoginSessions.loadById(ctx, sessionId, organization).catch(() => undefined)
			: undefined;
		if (!session && !sessionId) {
			session = await LoginSessions.loadMostRecent(ctx, { loginName, organization });
		}

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(
				ctx,
				organization ?? session?.factors?.user?.organizationId ?? defaultOrganization,
			),
			session: LoginDTO.optionalSession(session),
		} satisfies PasskeyModel.Page.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Verify passkey",
		description: "Checks the WebAuthn assertion on the session and returns the next step.",
		tags: [DOCS_TAGS.PASSKEY],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Passkey verified", LoginModels.FlowStep),
			APIResponseSpec.badRequest("The passkey could not be verified"),
		),
	}),

	zValidator("json", PasskeyModel.Send.Body),

	async (c) => {
		const { credentialAssertionData, ...command } = c.req.valid("json");
		const result = await LoginPasskeys.sendPasskey(LoginContext.from(c), {
			...command,
			checks: create(ChecksSchema, { webAuthN: { credentialAssertionData } }),
		});
		return LoginResponses.flow(c, "Passkey verified", result);
	},
);

router.get(
	"/set",

	APIRouteSpec.unauthenticated({
		summary: "Passkey setup page",
		description: "The session or user (registration link) for setting up a passkey.",
		tags: [DOCS_TAGS.PASSKEY],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", PasskeyModel.SetPage.Response),
		),
	}),

	zValidator("query", PasskeyModel.SetPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { userId, loginName, organization } = c.req.valid("query");

		// no session is fine for the userId (registration link) flow
		const session = loginName
			? await LoginSessions.loadMostRecent(ctx, { loginName, organization })
			: undefined;

		let user: PasskeyModel.SetPage.Response["user"] = null;
		if (userId) {
			const found = (
				await ZitadelAPI.getUserByID({ serviceConfig: ctx.serviceConfig, userId }).catch(
					() => undefined,
				)
			)?.user;
			if (found) {
				user = {
					loginName: found.preferredLoginName,
					displayName: found.type.case === "human" ? found.type.value.profile?.displayName : undefined,
				};
			}
		}

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, organization),
			session: LoginDTO.optionalSession(session),
			user,
		} satisfies PasskeyModel.SetPage.Response);
	},
);

router.post(
	"/registration",

	APIRouteSpec.unauthenticated({
		summary: "Start passkey registration",
		description:
			"Returns the WebAuthn creation options, for an authorized session or a registration code (email link).",
		tags: [DOCS_TAGS.PASSKEY],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Passkey registration started", PasskeyModel.Registration.Response),
			APIResponseSpec.badRequest("The passkey registration could not be started"),
		),
	}),

	zValidator("json", PasskeyModel.Registration.Body),

	async (c) => {
		const result = await LoginPasskeys.registerPasskeyLink(LoginContext.from(c), c.req.valid("json"));
		if ("error" in result) {
			return APIResponse.badRequest(c, result.error);
		}
		if (!result.passkeyId || !result.publicKeyCredentialCreationOptions) {
			return APIResponse.badRequest(c, "An error on registering passkey");
		}
		return APIResponse.success(c, "Passkey registration started", {
			passkeyId: result.passkeyId,
			publicKeyCredentialCreationOptions: result.publicKeyCredentialCreationOptions,
		} satisfies PasskeyModel.Registration.Response);
	},
);

router.post(
	"/registration/verify",

	APIRouteSpec.unauthenticated({
		summary: "Finish passkey registration",
		description: "Verifies the created credential and adds the passkey to the user.",
		tags: [DOCS_TAGS.PASSKEY],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Passkey registered", PasskeyModel.VerifyRegistration.Response),
			APIResponseSpec.badRequest("Could not verify Passkey"),
		),
	}),

	zValidator("json", PasskeyModel.VerifyRegistration.Body),

	async (c) => {
		try {
			const result = await LoginPasskeys.verifyPasskeyRegistration(
				LoginContext.from(c),
				c.req.valid("json"),
			);
			return APIResponse.success(c, "Passkey registered", {
				loginName: result.loginName,
			} satisfies PasskeyModel.VerifyRegistration.Response);
		} catch (error) {
			Logger.warn("Could not verify passkey registration:", error);
			return APIResponse.badRequest(c, "Could not verify Passkey");
		}
	},
);
