/**
 * Completing a login (port of the Zitadel login's `lib/client.ts`, `lib/server/auth-flow.ts`,
 * `lib/oidc.ts` and `lib/saml.ts`): finalize the OIDC auth request / SAML request with the
 * session from the cookie, hand device flows to `/signedin`, or pick the default redirect.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { type ServiceConfig, ZitadelAPI } from "../zitadel/api";
import { isClassifiedError } from "../zitadel/errors";
import {
	CreateCallbackRequestSchema,
	SessionSchema,
} from "../zitadel/proto/zitadel/oidc/v2/oidc_service_pb";
import { CreateResponseRequestSchema } from "../zitadel/proto/zitadel/saml/v2/saml_service_pb";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import type { LoginContext } from "./context";
import { type SessionCookie, SessionCookies } from "./cookies";
import { LoginName } from "./loginname";
import { Redirects } from "./redirect";
import { LoginSessions } from "./session";
import type { FlowResult } from "./types";

export type FinishFlowCommand = { sessionId: string; requestId: string } | { loginName: string };

export class LoginFlow {
	private static signedInPage(
		props:
			| { sessionId: string; organization?: string; requestId?: string }
			| { organization?: string; loginName: string; requestId?: string },
	) {
		const params = new URLSearchParams({});
		if ("loginName" in props && props.loginName) params.append("loginName", props.loginName);
		if ("sessionId" in props && props.sessionId) params.append("sessionId", props.sessionId);
		if (props.organization) params.append("organization", props.organization);
		// required to show conditional UI for device flow
		if (props.requestId) params.append("requestId", props.requestId);
		return `/signedin?${params}`;
	}

	/**
	 * OIDC/SAML requests are completed directly; device flows and flows without a request go to
	 * `/signedin` or the configured default redirect.
	 */
	static async completeFlowOrGetUrl(
		ctx: LoginContext,
		command: FinishFlowCommand & { organization?: string },
		defaultRedirectUri?: string,
	): Promise<FlowResult> {
		if (
			"sessionId" in command &&
			"requestId" in command &&
			(command.requestId.startsWith("saml_") || command.requestId.startsWith("oidc_"))
		) {
			return LoginFlow.completeAuthFlow(ctx, {
				sessionId: command.sessionId,
				requestId: command.requestId,
			});
		}

		return { redirect: LoginFlow.getNextUrl(ctx, command, defaultRedirectUri) };
	}

	static getNextUrl(
		ctx: LoginContext,
		command: FinishFlowCommand & { organization?: string },
		defaultRedirectUri?: string,
	): string {
		// finish Device Authorization Flow
		if (
			"requestId" in command &&
			command.requestId.startsWith("device_") &&
			("loginName" in command || "sessionId" in command)
		) {
			return LoginFlow.signedInPage({ ...command, organization: command.organization });
		}

		return LoginFlow.resolveRedirectUri(ctx, command, defaultRedirectUri);
	}

	/**
	 * 1. DEFAULT_REDIRECT_URI (a value starting with "/" is resolved against the public host)
	 * 2. defaultRedirectUri of the login settings
	 * 3. the relative `/signedin` page
	 */
	static resolveRedirectUri(
		ctx: LoginContext,
		command: FinishFlowCommand,
		defaultRedirectUri?: string,
	): string {
		const envOverride = ConfigHandler.getConfig()?.DEFAULT_REDIRECT_URI;
		if (envOverride) {
			if (!envOverride.startsWith("/")) return envOverride;
			try {
				return `${ctx.publicHostWithProtocol()}${envOverride}`;
			} catch (error) {
				Logger.warn("resolveRedirectUri: could not determine the host for the override", error);
			}
		}

		if (defaultRedirectUri) {
			if (Redirects.isSafeRedirectUri(defaultRedirectUri)) return defaultRedirectUri;
			Logger.warn("resolveRedirectUri: unsafe defaultRedirectUri prevented:", defaultRedirectUri);
		}

		return LoginFlow.signedInPage(command);
	}

	/** Completes an OIDC/SAML request with a session from the cookie. */
	static async completeAuthFlow(
		ctx: LoginContext,
		{ sessionId, requestId }: { sessionId: string; requestId: string },
	): Promise<FlowResult> {
		const sessionCookies = SessionCookies.getAll(ctx);
		const sessions = await LoginSessions.listFromCookies(
			ctx,
			sessionCookies.map((s) => s.id),
		);

		if (requestId.startsWith("oidc_")) {
			return LoginFlow.loginWithOIDCAndSession(ctx, {
				serviceConfig: ctx.serviceConfig,
				authRequest: requestId.replace("oidc_", ""),
				sessionId,
				sessions,
				sessionCookies,
			});
		}
		if (requestId.startsWith("saml_")) {
			return LoginFlow.loginWithSAMLAndSession(ctx, {
				serviceConfig: ctx.serviceConfig,
				samlRequest: requestId.replace("saml_", ""),
				sessionId,
				sessions,
				sessionCookies,
			});
		}
		return { error: "Invalid request ID format" };
	}

	/** Fallback when a request was already handled (old emails with a stale requestId). */
	private static async alreadyHandled(ctx: LoginContext, serviceConfig: ServiceConfig, session: Session) {
		const loginSettings = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: session.factors?.user?.organizationId,
		});

		if (loginSettings?.defaultRedirectUri && Redirects.isSafeRedirectUri(loginSettings.defaultRedirectUri)) {
			return { redirect: loginSettings.defaultRedirectUri };
		}
		if (loginSettings?.defaultRedirectUri) {
			Logger.warn("Unsafe defaultRedirectUri prevented:", loginSettings.defaultRedirectUri);
		}

		const params = new URLSearchParams();
		if (session.factors?.user?.loginName) params.append("loginName", session.factors.user.loginName);
		if (session.factors?.user?.organizationId) {
			params.append("organization", session.factors.user.organizationId);
		}
		void ctx;
		return { redirect: `/signedin?${params}` };
	}

	static async loginWithOIDCAndSession(
		ctx: LoginContext,
		{
			serviceConfig,
			authRequest,
			sessionId,
			sessions,
			sessionCookies,
		}: {
			serviceConfig: ServiceConfig;
			authRequest: string;
			sessionId: string;
			sessions: Session[];
			sessionCookies: SessionCookie[];
		},
	): Promise<FlowResult> {
		const selectedSession = sessions.find((s) => s.id === sessionId);

		if (selectedSession?.id) {
			const isValid = await LoginSessions.isSessionValid({ serviceConfig, session: selectedSession });

			if (!isValid && selectedSession.factors?.user) {
				// the session is not valid anymore: re-authenticate
				const res = await LoginName.sendLoginname(ctx, {
					loginName: selectedSession.factors.user.loginName,
					organization: selectedSession.factors.user.organizationId,
					requestId: `oidc_${authRequest}`,
				});
				if (res && "redirect" in res && res.redirect) {
					return { redirect: res.redirect };
				}
			}

			const cookie = sessionCookies.find((c) => c.id === selectedSession.id);
			if (cookie?.id && cookie.token) {
				try {
					const { callbackUrl } = await ZitadelAPI.createCallback({
						serviceConfig,
						req: create(CreateCallbackRequestSchema, {
							authRequestId: authRequest,
							callbackKind: {
								case: "session",
								value: create(SessionSchema, { sessionId: cookie.id, sessionToken: cookie.token }),
							},
						}),
					});
					if (!callbackUrl) return { error: "An error occurred!" };
					if (!Redirects.isSafeRedirectUri(callbackUrl)) {
						Logger.warn("loginWithOIDCAndSession: blocked unsafe OIDC callback URL:", callbackUrl);
						return { error: "Unsafe redirect URI was blocked" };
					}
					return { redirect: callbackUrl };
				} catch (error) {
					// gracefully handle already handled requests (old reset/register emails)
					Logger.error("createCallback failed:", error);
					if (isClassifiedError(error) && error.code === Code.FailedPrecondition) {
						return LoginFlow.alreadyHandled(ctx, serviceConfig, selectedSession);
					}
					return { error: "Unknown error occurred" };
				}
			}
		}

		return { error: "Session not found or invalid" };
	}

	static async loginWithSAMLAndSession(
		ctx: LoginContext,
		{
			serviceConfig,
			samlRequest,
			sessionId,
			sessions,
			sessionCookies,
		}: {
			serviceConfig: ServiceConfig;
			samlRequest: string;
			sessionId: string;
			sessions: Session[];
			sessionCookies: SessionCookie[];
		},
	): Promise<FlowResult> {
		const selectedSession = sessions.find((s) => s.id === sessionId);

		if (selectedSession?.id) {
			const isValid = await LoginSessions.isSessionValid({ serviceConfig, session: selectedSession });

			if (!isValid && selectedSession.factors?.user) {
				const res = await LoginName.sendLoginname(ctx, {
					loginName: selectedSession.factors.user.loginName,
					organization: selectedSession.factors.user.organizationId,
					requestId: `saml_${samlRequest}`,
				});
				if (res && "redirect" in res && res.redirect) return { redirect: res.redirect };
				if (res && "samlData" in res && res.samlData) return { samlData: res.samlData };
			}

			const cookie = sessionCookies.find((c) => c.id === selectedSession.id);
			if (cookie?.id && cookie.token) {
				try {
					const { url, binding } = await ZitadelAPI.createResponse({
						serviceConfig,
						req: create(CreateResponseRequestSchema, {
							samlRequestId: samlRequest,
							responseKind: {
								case: "session",
								value: { sessionId: cookie.id, sessionToken: cookie.token },
							},
						}),
					});
					if (url && binding.case === "redirect") {
						if (!Redirects.isSafeRedirectUri(url)) {
							Logger.warn("loginWithSAMLAndSession: blocked unsafe SAML redirect URL:", url);
							return { error: "Unsafe redirect URI was blocked" };
						}
						return { redirect: url };
					}
					if (url && binding.case === "post") {
						if (!Redirects.isSafeRedirectUri(url)) {
							Logger.warn("loginWithSAMLAndSession: blocked unsafe SAML post URL:", url);
							return { error: "Unsafe redirect URI was blocked" };
						}
						return {
							samlData: {
								url,
								fields: {
									RelayState: binding.value.relayState,
									SAMLResponse: binding.value.samlResponse,
								},
							},
						};
					}
					return { error: "An error occurred!" };
				} catch (error) {
					Logger.error("createResponse failed:", error);
					if (isClassifiedError(error) && error.code === Code.FailedPrecondition) {
						return LoginFlow.alreadyHandled(ctx, serviceConfig, selectedSession);
					}
					return { error: "Unknown error occurred" };
				}
			}
		}

		return { error: "Session not found or invalid" };
	}
}
