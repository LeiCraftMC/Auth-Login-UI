/**
 * MFA rules (port of the Zitadel login's `lib/mfa-helper.ts`).
 */
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { type ServiceConfig, ZitadelAPI } from "../zitadel/api";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import type { LoginSettings } from "../zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { AuthenticationMethodType } from "../zitadel/proto/zitadel/user/v2/user_service_pb";

export class MFA {
	/**
	 * Where to go after the primary factor: the single configured second factor, the factor
	 * chooser, or the MFA setup when the policy forces (or suggests) one. `undefined` = done.
	 */
	static async checkMFAFactors(
		serviceConfig: ServiceConfig,
		session: Session,
		loginSettings: LoginSettings | undefined,
		authMethods: AuthenticationMethodType[],
		organization?: string,
		requestId?: string,
	): Promise<{ redirect: string } | undefined> {
		const availableMultiFactors = authMethods?.filter(
			(m) =>
				m === AuthenticationMethodType.TOTP ||
				m === AuthenticationMethodType.OTP_SMS ||
				m === AuthenticationMethodType.OTP_EMAIL ||
				m === AuthenticationMethodType.U2F,
		);

		// escape further checks if the user authenticated with a (user-verified) passkey
		if (session.factors?.webAuthN?.verifiedAt && session.factors?.webAuthN?.userVerified) {
			return undefined;
		}

		const baseParams = () => {
			const params = new URLSearchParams({ loginName: session.factors?.user?.loginName as string });
			return params;
		};
		const appendContext = (params: URLSearchParams) => {
			if (requestId) params.append("requestId", requestId);
			if (organization || session.factors?.user?.organizationId) {
				params.append(
					"organization",
					organization ?? (session.factors?.user?.organizationId as string),
				);
			}
			return params;
		};

		if (availableMultiFactors?.length === 1) {
			const params = appendContext(baseParams());
			const factor = availableMultiFactors[0];
			if (factor === AuthenticationMethodType.TOTP) return { redirect: `/otp/time-based?${params}` };
			if (factor === AuthenticationMethodType.OTP_SMS) return { redirect: `/otp/sms?${params}` };
			if (factor === AuthenticationMethodType.OTP_EMAIL) return { redirect: `/otp/email?${params}` };
			if (factor === AuthenticationMethodType.U2F) return { redirect: `/u2f?${params}` };
		} else if (availableMultiFactors?.length > 1) {
			return { redirect: `/mfa?${appendContext(baseParams())}` };
		} else if (MFA.shouldEnforceMFA(session, loginSettings) && !availableMultiFactors.length) {
			const params = new URLSearchParams({
				loginName: session.factors?.user?.loginName as string,
				force: "true", // the MFA is forced in the settings
				checkAfter: "true", // check the factor directly after the setup
			});
			if (session.id) params.append("sessionId", session.id);
			return { redirect: `/mfa/set?${appendContext(params)}` };
		} else if (
			// biome-ignore lint/suspicious/noDuplicateElseIf: covered by the branch above in the Zitadel login too (eslint no-dupe-else-if disabled there); kept for parity
			loginSettings?.mfaInitSkipLifetime &&
			(loginSettings.mfaInitSkipLifetime.nanos > 0 || loginSettings.mfaInitSkipLifetime.seconds > 0) &&
			!availableMultiFactors.length &&
			session?.factors?.user?.id &&
			MFA.shouldEnforceMFA(session, loginSettings)
		) {
			const userResponse = await ZitadelAPI.getUserByID({
				serviceConfig,
				userId: session.factors.user.id,
			});
			const humanUser =
				userResponse?.user?.type.case === "human" ? userResponse.user.type.value : undefined;

			if (humanUser?.mfaInitSkipped) {
				const lifetimeMillis =
					Number(loginSettings.mfaInitSkipLifetime.seconds) * 1000 +
					loginSettings.mfaInitSkipLifetime.nanos / 1000000;
				if (!(Date.now() - timestampDate(humanUser.mfaInitSkipped).getTime() > lifetimeMillis)) {
					return undefined;
				}
			}

			const params = new URLSearchParams({
				loginName: session.factors?.user?.loginName as string,
				force: "false", // the MFA can be skipped
				checkAfter: "true",
			});
			if (session.id) params.append("sessionId", session.id);
			return { redirect: `/mfa/set?${appendContext(params)}` };
		}

		return undefined;
	}

	/** Whether MFA must be enforced for how the session authenticated (passkeys never need it). */
	static shouldEnforceMFA(session: Session, loginSettings: LoginSettings | undefined): boolean {
		if (!loginSettings) return false;

		if (session.factors?.webAuthN?.verifiedAt && session.factors?.webAuthN?.userVerified) {
			return false;
		}

		if (loginSettings.forceMfa) return true;

		if (loginSettings.forceMfaLocalOnly) {
			// forceMfaLocalOnly only applies to local (password) authentication, never to IdP logins
			if (session.factors?.intent?.verifiedAt) return false;
			if (session.factors?.password?.verifiedAt) return true;
		}

		return false;
	}
}
