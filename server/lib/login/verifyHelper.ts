/**
 * Post-authentication checks (port of the Zitadel login's `lib/verify-helper.ts`).
 */
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConfigHandler } from "../utils/config";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import type { PasswordExpirySettings } from "../zitadel/proto/zitadel/settings/v2/password_settings_pb";
import type { HumanUser } from "../zitadel/proto/zitadel/user/v2/user_pb";
import type { LoginContext } from "./context";
import { LoginVerify } from "./verify";

const DAY_MS = 24 * 60 * 60 * 1000;

export class VerifyHelper {
	/** Redirect to `/password/change` if the password must be changed or is older than allowed. */
	static checkPasswordChangeRequired(
		expirySettings: PasswordExpirySettings | undefined,
		session: Session,
		humanUser: HumanUser | undefined,
		organization?: string,
		requestId?: string,
	): { redirect: string } | undefined {
		let isOutdated = false;
		if (expirySettings?.maxAgeDays && humanUser?.passwordChanged) {
			const maxAgeDays = Number(expirySettings.maxAgeDays);
			const changedAt = timestampDate(humanUser.passwordChanged).getTime();
			isOutdated = Date.now() > changedAt + maxAgeDays * DAY_MS;
		}

		if (humanUser?.passwordChangeRequired || isOutdated) {
			const params = new URLSearchParams({ loginName: session.factors?.user?.loginName as string });
			if (organization || session.factors?.user?.organizationId) {
				params.append("organization", session.factors?.user?.organizationId as string);
			}
			if (requestId) params.append("requestId", requestId);
			return { redirect: `/password/change?${params}` };
		}
		return undefined;
	}

	/** Redirect to `/verify` (with a fresh code) if the user's email is not verified. */
	static async checkEmailVerified(
		ctx: LoginContext,
		session: Session,
		humanUser?: HumanUser,
		organization?: string,
		requestId?: string,
	): Promise<{ redirect: string } | undefined> {
		if (humanUser?.email?.isVerified) return undefined;

		const codeSent = await LoginVerify.trySendVerification(ctx, {
			userId: session.factors?.user?.id as string,
			isInvite: false,
			requestId,
		});

		const params = new URLSearchParams({
			loginName: session.factors?.user?.loginName as string,
			userId: session.factors?.user?.id as string, // verify needs user id
		});
		if (codeSent) params.append("codeSent", "true");
		if (organization || session.factors?.user?.organizationId) {
			params.append("organization", organization ?? (session.factors?.user?.organizationId as string));
		}
		if (requestId) params.append("requestId", requestId);
		return { redirect: `/verify?${params}` };
	}

	/** Like {@link checkEmailVerified}, but only when EMAIL_VERIFICATION is enabled. */
	static async checkEmailVerification(
		ctx: LoginContext,
		session: Partial<Session>,
		humanUser?: HumanUser,
		organization?: string,
		requestId?: string,
	): Promise<{ redirect: string } | undefined> {
		if (humanUser?.email?.isVerified || !ConfigHandler.getConfig()?.EMAIL_VERIFICATION) {
			return undefined;
		}

		const codeSent = await LoginVerify.trySendVerification(ctx, {
			userId: session.factors?.user?.id as string,
			isInvite: false,
			requestId,
		});

		const params = new URLSearchParams({ loginName: session.factors?.user?.loginName as string });
		if (codeSent) params.append("codeSent", "true");
		if (requestId) params.append("requestId", requestId);
		if (organization || session.factors?.user?.organizationId) {
			params.append("organization", organization ?? (session.factors?.user?.organizationId as string));
		}
		return { redirect: `/verify?${params}` };
	}
}
