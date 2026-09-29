/**
 * Starting external IdP logins and creating sessions from IdP intents (port of the Zitadel
 * login's `lib/server/idp.ts`).
 */
import { createHash } from "node:crypto";
import { ZitadelAPI } from "../zitadel/api";
import type { LoginContext } from "./context";
import { LoginCookies, SessionCookies } from "./cookies";
import { LoginFlow } from "./flow";
import { LoginName } from "./loginname";
import { MFA } from "./mfa";
import { LoginSessionCookie } from "./sessionCookie";
import type { FlowResult } from "./types";
import { VerifyHelper } from "./verifyHelper";

export class LoginIdp {
	/** Hash binding an IdP link request to this browser (checked when the IdP returns). */
	static linkFingerprint(sessionId: string, fingerprintId: string) {
		return createHash("sha256")
			.update(sessionId + fingerprintId)
			.digest("hex");
	}

	/** Starts the flow of the IdP button (Zitadel login: the `redirectToIdp` form action). */
	static async redirectToIdp(
		ctx: LoginContext,
		command: {
			id: string;
			provider: string;
			sessionId?: string;
			requestId?: string;
			organization?: string;
			postErrorRedirectUrl?: string;
			loginHint?: string;
		},
	): Promise<FlowResult> {
		const params = new URLSearchParams();

		if (command.sessionId) {
			try {
				SessionCookies.getById(ctx, { sessionId: command.sessionId });
				const fingerprintId = LoginCookies.getOrSetFingerprintId(ctx);
				params.set("linkToSessionId", command.sessionId);
				params.set("linkFingerprint", LoginIdp.linkFingerprint(command.sessionId, fingerprintId));
			} catch {
				return { error: "Invalid session for linking" };
			}
		}
		if (command.requestId) params.set("requestId", command.requestId);
		if (command.organization) params.set("organization", command.organization);
		if (command.postErrorRedirectUrl) params.set("postErrorRedirectUrl", command.postErrorRedirectUrl);

		// LDAP asks for username and password on its own page
		if (command.provider === "ldap") {
			params.set("idpId", command.id);
			return { redirect: `/idp/ldap?${params}` };
		}

		const response = await ZitadelAPI.startIdentityProviderFlow({
			serviceConfig: ctx.serviceConfig,
			idpId: command.id,
			urls: {
				successUrl: LoginName.idpCallbackUrl(ctx, command.provider, "process", params),
				failureUrl: LoginName.idpCallbackUrl(ctx, command.provider, "failure", params),
				loginHint: command.loginHint || undefined,
			},
		});

		if (!response || !response.url) return { error: "Could not start IDP flow" };
		if (response.fields) return { samlData: { url: response.url, fields: response.fields } };
		return { redirect: response.url };
	}

	static async createNewSessionFromIdpIntent(
		ctx: LoginContext,
		command: {
			userId: string;
			idpIntent: { idpIntentId: string; idpIntentToken: string };
			loginName?: string;
			organization?: string;
			requestId?: string;
		},
	): Promise<FlowResult> {
		const serviceConfig = ctx.serviceConfig;

		if (!command.userId || !command.idpIntent) {
			throw new Error("No userId or loginName provided");
		}

		const userResponse = await ZitadelAPI.getUserByID({ serviceConfig, userId: command.userId });
		if (!userResponse?.user) return { error: "User not found in the system" };

		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: userResponse.user.details?.resourceOwner,
		});

		const session = await LoginSessionCookie.createSessionForIdpAndUpdateCookie(ctx, {
			userId: command.userId,
			idpIntent: command.idpIntent,
			requestId: command.requestId,
			lifetime: loginSettings?.externalLoginCheckLifetime,
		});

		if (!session?.factors?.user) return { error: "Could not create session" };

		const humanUser = userResponse.user.type.case === "human" ? userResponse.user.type.value : undefined;

		const emailVerificationCheck = await VerifyHelper.checkEmailVerification(
			ctx,
			session,
			humanUser,
			command.organization,
			command.requestId,
		);
		if (emailVerificationCheck?.redirect) return emailVerificationCheck;

		let authMethods: Awaited<ReturnType<typeof ZitadelAPI.listAuthenticationMethodTypes>>["authMethodTypes"] | undefined;
		if (session.factors.user.id) {
			const response = await ZitadelAPI.listAuthenticationMethodTypes({
				serviceConfig,
				userId: session.factors.user.id,
			});
			if (response.authMethodTypes?.length) authMethods = response.authMethodTypes;
		}

		const mfaFactorCheck = await MFA.checkMFAFactors(
			serviceConfig,
			session,
			loginSettings,
			authMethods || [],
			command.organization,
			command.requestId,
		);
		if (mfaFactorCheck?.redirect) return mfaFactorCheck;

		return LoginFlow.completeFlowOrGetUrl(
			ctx,
			command.requestId && session.id
				? { sessionId: session.id, requestId: command.requestId, organization: session.factors.user.organizationId }
				: { loginName: session.factors.user.loginName, organization: session.factors.user.organizationId },
			loginSettings?.defaultRedirectUri,
		);
	}

	/** Authenticates at an LDAP IdP and continues with its intent (like any IdP callback). */
	static async createNewSessionForLDAP(
		ctx: LoginContext,
		command: {
			username: string;
			password: string;
			idpId: string;
			link: boolean;
			requestId?: string;
			organization?: string;
			postErrorRedirectUrl?: string;
			linkToSessionId?: string;
			linkFingerprint?: string;
		},
	): Promise<FlowResult> {
		if (!command.username || !command.password) {
			return { error: "No username or password provided" };
		}

		const response = await ZitadelAPI.startLDAPIdentityProviderFlow({
			serviceConfig: ctx.serviceConfig,
			idpId: command.idpId,
			username: command.username,
			password: command.password,
		});

		if (!response || response.nextStep.case !== "idpIntent" || !response.nextStep.value) {
			return { error: "Could not start LDAP identity provider flow" };
		}

		const { userId, idpIntentId, idpIntentToken } = response.nextStep.value;

		const params = new URLSearchParams({ userId, id: idpIntentId, token: idpIntentToken });
		if (command.link) params.set("link", "true");
		if (command.requestId) params.set("requestId", command.requestId);
		if (command.organization) params.set("organization", command.organization);
		if (command.postErrorRedirectUrl) params.set("postErrorRedirectUrl", command.postErrorRedirectUrl);
		if (command.linkToSessionId) params.set("linkToSessionId", command.linkToSessionId);
		if (command.linkFingerprint) params.set("linkFingerprint", command.linkFingerprint);

		return { redirect: `/idp/ldap/process?${params}` };
	}
}
