/**
 * Security gates shared by several flows: OTP challenge sanitizing (Zitadel login:
 * `lib/server/challenges.ts`) and the credential-enrollment guard (`lib/server/enrollment-guard.ts`).
 */
import { create } from "@bufbuild/protobuf";
import { Logger } from "../utils/logger";
import { type ServiceConfig, ZitadelAPI } from "../zitadel/api";
import {
	type RequestChallenges,
	RequestChallenges_OTPEmail_SendCodeSchema,
} from "../zitadel/proto/zitadel/session/v2/challenge_pb";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import type { LoginContext } from "./context";
import { LoginCookies } from "./cookies";
import { LoginSessions } from "./session";

export class LoginSecurity {
	/**
	 * Rewrites the `returnCode` delivery of client-supplied OTP challenges to out-of-band delivery.
	 *
	 * `returnCode` makes Zitadel return the OTP in plaintext. Everything this app forwards is
	 * attacker-controllable and everything it returns attacker-readable, so a party knowing only a
	 * login name could otherwise read both codes and verify them (GHSA-3gwm-5wx8-4gm6).
	 */
	static sanitizeChallenges(challenges?: RequestChallenges): RequestChallenges | undefined {
		if (!challenges) return challenges;

		const sanitized = { ...challenges };

		if (sanitized.otpSms) {
			sanitized.otpSms = { ...sanitized.otpSms, returnCode: false };
		}

		if (sanitized.otpEmail?.deliveryType?.case === "returnCode") {
			sanitized.otpEmail = {
				...sanitized.otpEmail,
				// fall back to the default Zitadel verification url
				deliveryType: { case: "sendCode", value: create(RequestChallenges_OTPEmail_SendCodeSchema, {}) },
			};
		}

		return sanitized;
	}

	/**
	 * Authorization gate for attaching a new authenticator (passkey, U2F, TOTP, OTP, IdP link).
	 * Allowed when the session proves authentication, or the user has no auth methods yet and a
	 * user-verification check (email / invite code) was done in this browser. `null` = allowed.
	 */
	static async getEnrollmentAuthorizationError(
		ctx: LoginContext,
		{
			serviceConfig,
			session,
			userId,
		}: { serviceConfig: ServiceConfig; session: Partial<Session>; userId: string },
	): Promise<string | null> {
		if (LoginSessions.hasVerifiedPrimaryFactor(session).valid) {
			return null;
		}

		// The session is only "identified", not authenticated.
		const authMethods = await ZitadelAPI.listAuthenticationMethodTypes({ serviceConfig, userId });

		if (authMethods.authMethodTypes.length !== 0) {
			return "You have to authenticate or have a valid User Verification Check";
		}

		const hasValidUserVerificationCheck = LoginCookies.checkUserVerification(ctx, userId);
		Logger.info("hasValidUserVerificationCheck", hasValidUserVerificationCheck);
		if (!hasValidUserVerificationCheck) {
			return "User Verification Check has to be done";
		}

		return null;
	}
}
