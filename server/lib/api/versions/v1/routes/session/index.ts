import { create } from "@bufbuild/protobuf";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { LoginSessionActions } from "../../../../../login/sessionActions";
import { Logger } from "../../../../../utils/logger";
import {
	RequestChallengesSchema,
	UserVerificationRequirement,
} from "../../../../../zitadel/proto/zitadel/session/v2/challenge_pb";
import type { Session } from "../../../../../zitadel/proto/zitadel/session/v2/session_pb";
import { ChecksSchema } from "../../../../../zitadel/proto/zitadel/session/v2/session_service_pb";
import { APIResponse } from "../../../../utils/api-res";
import { LoginResponses } from "../../../../utils/loginResponses";
import { LoginDTO, LoginModels } from "../../../../utils/shared-models/loginModels";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { SessionModel } from "./model";

export const router = new Hono().basePath("/session");

const USER_VERIFICATION: Record<string, UserVerificationRequirement> = {
	required: UserVerificationRequirement.REQUIRED,
	preferred: UserVerificationRequirement.PREFERRED,
	discouraged: UserVerificationRequirement.DISCOURAGED,
};

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Update session",
		description:
			"Requests challenges (WebAuthn, OTP via email/SMS) and/or checks OTP codes on the session of the cookie, creating one for the login name if needed.",
		tags: [DOCS_TAGS.SESSION],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Session updated", SessionModel.Update.Response),
			APIResponseSpec.badRequest("The session could not be updated"),
		),
	}),

	zValidator("json", SessionModel.Update.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { challenges, checks, ...command } = c.req.valid("json");

		let requestChallenges: ReturnType<typeof create<typeof RequestChallengesSchema>> | undefined;
		if (challenges?.webAuthN || challenges?.otpEmail || challenges?.otpSms) {
			const host = ctx.publicHost();
			requestChallenges = create(RequestChallengesSchema, {
				webAuthN: challenges.webAuthN
					? {
							domain: "", // filled in with the public hostname
							userVerificationRequirement:
								USER_VERIFICATION[challenges.webAuthN.userVerificationRequirement],
						}
					: undefined,
				otpEmail: challenges.otpEmail
					? {
							deliveryType: {
								case: "sendCode",
								value: {
									urlTemplate:
										`${host.includes("localhost") ? "http://" : "https://"}${host}${LoginContext.getBasePath()}/otp/email?code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}` +
										(command.requestId ? `&requestId=${command.requestId}` : ""),
								},
							},
						}
					: undefined,
				otpSms: challenges.otpSms ? {} : undefined,
			});
		}

		const requestChecks =
			checks?.totp || checks?.otpSms || checks?.otpEmail
				? create(ChecksSchema, {
						totp: checks.totp ? { code: checks.totp.code } : undefined,
						otpSms: checks.otpSms ? { code: checks.otpSms.code } : undefined,
						otpEmail: checks.otpEmail ? { code: checks.otpEmail.code } : undefined,
					})
				: undefined;

		let result: Awaited<ReturnType<typeof LoginSessionActions.updateOrCreateSession>>;
		try {
			result = await LoginSessionActions.updateOrCreateSession(ctx, {
				...command,
				challenges: requestChallenges,
				checks: requestChecks,
			});
		} catch (error) {
			Logger.warn("Could not update session:", error);
			// the messages the Zitadel login's forms show when the action throws
			if (challenges?.webAuthN) {
				return APIResponse.badRequest(
					c,
					(await ctx.t("passkey"))("verify.errors.couldNotRequestChallenge"),
				);
			}
			const t = await ctx.t("otp");
			return APIResponse.badRequest(
				c,
				requestChecks ? t("errors.couldNotVerifyCode") : t("errors.couldNotRequestChallenge"),
			);
		}

		if ("error" in result) {
			return APIResponse.badRequest(c, result.error);
		}

		return APIResponse.success(c, "Session updated", {
			session: LoginDTO.session({ id: result.sessionId, factors: result.factors } as Session),
			challenges: result.challenges?.webAuthN
				? {
						webAuthN: {
							publicKeyCredentialRequestOptions:
								result.challenges.webAuthN.publicKeyCredentialRequestOptions,
						},
					}
				: undefined,
			authMethods: result.authMethods ? LoginDTO.authMethods(result.authMethods) : undefined,
		} satisfies SessionModel.Update.Response);
	},
);

router.post(
	"/continue",

	APIRouteSpec.unauthenticated({
		summary: "Continue with session",
		description:
			"Continues the login with an account of this browser: completes the request if the session is valid, otherwise re-authenticates.",
		tags: [DOCS_TAGS.SESSION],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Next step resolved", LoginModels.FlowStep),
			APIResponseSpec.badRequest("Could not continue with session"),
		),
	}),

	zValidator("json", SessionModel.Continue.Body),

	async (c) => {
		const result = await LoginSessionActions.continueWithSession(
			LoginContext.from(c),
			c.req.valid("json"),
		);
		return LoginResponses.flow(c, "Next step resolved", result);
	},
);

router.delete(
	"/:sessionId",

	APIRouteSpec.unauthenticated({
		summary: "End session",
		description: "Terminates the session in Zitadel and removes it from this browser.",
		tags: [DOCS_TAGS.SESSION],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Session ended"),
			APIResponseSpec.badRequest("Could not end the session"),
		),
	}),

	zValidator("param", SessionModel.Clear.Params),

	async (c) => {
		const { sessionId } = c.req.valid("param");
		const result = await LoginSessionActions.clearSession(LoginContext.from(c), { sessionId });
		return LoginResponses.done(c, "Session ended", result);
	},
);
