/**
 * U2F security keys as second factor (port of the Zitadel login's `lib/server/u2f.ts`).
 */
import { create, type JsonObject } from "@bufbuild/protobuf";
import { ZitadelAPI } from "../zitadel/api";
import { VerifyU2FRegistrationRequestSchema } from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import type { LoginContext } from "./context";
import { SessionCookies } from "./cookies";
import { LoginSecurity } from "./security";
import { LoginUserAgent } from "./userAgent";

export class LoginU2F {
	private static async authorizedSession(ctx: LoginContext, sessionId: string) {
		const sessionCookie = SessionCookies.getById(ctx, { sessionId });
		if (!sessionCookie) return { error: "Could not get session" } as const;

		const session = await ZitadelAPI.getSession({
			serviceConfig: ctx.serviceConfig,
			sessionId: sessionCookie.id,
			sessionToken: sessionCookie.token,
		});

		const userId = session?.session?.factors?.user?.id;
		if (!session?.session || !userId) return { error: "Could not get session" } as const;

		// An identify-only session must not attach a new authenticator (GHSA-45f2-5q3r-xgg6).
		const enrollmentError = await LoginSecurity.getEnrollmentAuthorizationError(ctx, {
			serviceConfig: ctx.serviceConfig,
			session: session.session,
			userId,
		});
		if (enrollmentError) return { error: enrollmentError } as const;

		return { userId } as const;
	}

	static async addU2F(ctx: LoginContext, { sessionId }: { sessionId: string }) {
		const [hostname] = ctx.publicHost().split(":");
		if (!hostname) throw new Error("Could not get hostname");

		const authorized = await LoginU2F.authorizedSession(ctx, sessionId);
		if ("error" in authorized) return { error: authorized.error };

		return ZitadelAPI.registerU2F({
			serviceConfig: ctx.serviceConfig,
			userId: authorized.userId,
			domain: hostname,
		});
	}

	static async verifyU2F(
		ctx: LoginContext,
		command: {
			u2fId: string;
			passkeyName?: string;
			publicKeyCredential: JsonObject;
			sessionId: string;
		},
	) {
		const tokenName = command.passkeyName || LoginUserAgent.authenticatorName(ctx);

		const authorized = await LoginU2F.authorizedSession(ctx, command.sessionId);
		if ("error" in authorized) return { error: authorized.error };

		return ZitadelAPI.verifyU2FRegistration({
			serviceConfig: ctx.serviceConfig,
			request: create(VerifyU2FRegistrationRequestSchema, {
				u2fId: command.u2fId,
				publicKeyCredential: command.publicKeyCredential,
				tokenName,
				userId: authorized.userId,
			}),
		});
	}
}
