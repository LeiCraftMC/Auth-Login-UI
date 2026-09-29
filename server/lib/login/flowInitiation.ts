/**
 * OIDC / SAML flow initiation — the `GET /login?authRequest=…|samlRequest=…` entry point Zitadel
 * redirects to (port of the Zitadel login's `app/login/route.ts` + `lib/server/flow-initiation.ts`).
 *
 * Handles prompt (create, select_account, login, none), org scopes, IdP scopes, `login_hint` and
 * `ui_locales`, then either completes the request with an existing session or sends the user to
 * the right page. Answers are protocol-native (redirects, auto-submit HTML, JSON errors).
 */
import { create } from "@bufbuild/protobuf";
import { I18n } from "../i18n";
import { Logger } from "../utils/logger";
import { ZitadelAPI } from "../zitadel/api";
import { Prompt } from "../zitadel/proto/zitadel/oidc/v2/authorization_pb";
import {
	CreateCallbackRequestSchema,
	SessionSchema,
} from "../zitadel/proto/zitadel/oidc/v2/oidc_service_pb";
import { CreateResponseRequestSchema } from "../zitadel/proto/zitadel/saml/v2/saml_service_pb";
import type { Session } from "../zitadel/proto/zitadel/session/v2/session_pb";
import { IdentityProviderType } from "../zitadel/proto/zitadel/settings/v2/login_settings_pb";
import type { SecuritySettings } from "../zitadel/proto/zitadel/settings/v2/security_settings_pb";
import type { LoginContext } from "./context";
import { LoginCookies, type SessionCookie, SessionCookies } from "./cookies";
import { LoginCSP } from "./csp";
import { IdpTypes } from "./idpTypes";
import { LoginName } from "./loginname";
import { Redirects } from "./redirect";
import { LoginSessions } from "./session";

const ORG_SCOPE_REGEX = /urn:zitadel:iam:org:id:([0-9]+)/;
const ORG_DOMAIN_SCOPE_REGEX = /urn:zitadel:iam:org:domain:primary:(.+)/;
const IDP_SCOPE_REGEX = /urn:zitadel:iam:org:idp:id:(.+)/;

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export class FlowInitiation {
	/** The request id of a `/login` request (`requestId`, or `authRequest` / `samlRequest`). */
	static validateAuthRequest(searchParams: URLSearchParams): string | null {
		const oidcRequestId = searchParams.get("authRequest");
		const samlRequestId = searchParams.get("samlRequest");

		const requestId =
			searchParams.get("requestId") ??
			(oidcRequestId ? `oidc_${oidcRequestId}` : samlRequestId ? `saml_${samlRequestId}` : undefined);

		return requestId || null;
	}

	static json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
		return new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json", ...headers },
		});
	}

	static redirect(url: string | URL, headers: Record<string, string> = {}) {
		return new Response(null, { status: 307, headers: { Location: url.toString(), ...headers } });
	}

	/**
	 * A minimal page that immediately POSTs `fields` to `url` (SAML POST binding, form-data IdPs),
	 * with a <noscript> fallback. Callers validate `url` first; all values are HTML-escaped.
	 */
	static autoSubmitForm(url: string, fields: Record<string, string>) {
		const hiddenInputs = Object.entries(fields)
			.map(
				([key, value]) =>
					`<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`,
			)
			.join("\n");

		const html = `
    <html>
      <body onload="document.forms[0].submit()">
        <form action="${escapeHtml(url)}" method="post">
          ${hiddenInputs}
          <noscript>
            <button type="submit">Continue</button>
          </noscript>
        </form>
      </body>
    </html>
  `;
		return new Response(html, { headers: { "Content-Type": "text/html" } });
	}

	private static cspHeaders(ctx: LoginContext, securitySettings: SecuritySettings | undefined) {
		const iframeOrigins =
			securitySettings?.embeddedIframe?.enabled &&
			securitySettings.embeddedIframe.allowedOrigins.length > 0
				? securitySettings.embeddedIframe.allowedOrigins
				: undefined;
		return {
			"Content-Security-Policy": LoginCSP.build({
				serviceUrl: ctx.serviceConfig.baseUrl,
				iframeOrigins,
			}),
			...(iframeOrigins ? {} : { "X-Frame-Options": "deny" }),
		};
	}

	private static gotoAccounts(
		ctx: LoginContext,
		{
			requestId,
			organization,
			orgDomain,
		}: { requestId: string; organization?: string; orgDomain?: string },
	) {
		const url = ctx.url("/accounts");
		if (requestId) url.searchParams.set("requestId", requestId);
		if (organization) url.searchParams.set("organization", organization);
		if (orgDomain) url.searchParams.set("orgDomain", orgDomain);
		return FlowInitiation.redirect(url);
	}

	private static gotoLoginname(
		ctx: LoginContext,
		{
			requestId,
			loginHint,
			organization,
			orgDomain,
		}: { requestId: string; loginHint?: string; organization?: string; orgDomain?: string },
	) {
		const url = ctx.url("/loginname");
		url.searchParams.set("requestId", requestId);
		// prefill only, no auto-submit (see resolveLoginHint)
		if (loginHint) url.searchParams.set("loginName", loginHint);
		if (organization) url.searchParams.set("organization", organization);
		if (orgDomain) url.searchParams.set("orgDomain", orgDomain);
		return FlowInitiation.redirect(url);
	}

	/**
	 * Resolves a `login_hint` straight to the next step (e.g. /password), skipping the login-name
	 * page. null when there is no hint or it can't be resolved (callers prefill /loginname).
	 */
	private static async resolveLoginHint(
		ctx: LoginContext,
		{
			requestId,
			loginHint,
			organization,
		}: { requestId: string; loginHint?: string; organization?: string },
	): Promise<Response | null> {
		if (!loginHint) return null;

		try {
			// sendLoginname applies enumeration protection itself, so an unknown hint leads to the
			// (fake) /password step like a known one.
			const res = await LoginName.sendLoginname(ctx, {
				loginName: loginHint,
				requestId,
				organization: organization || undefined,
			});

			if (res && "redirect" in res && res.redirect) {
				// may be absolute (IdP authorize endpoint); only relative paths get the base path
				if (Redirects.isExternalUrl(res.redirect)) {
					if (!Redirects.isSafeRedirectUri(res.redirect)) {
						Logger.warn("Blocked unsafe login_hint redirect URL", { redirect: res.redirect });
						return null;
					}
					return FlowInitiation.redirect(res.redirect);
				}
				return FlowInitiation.redirect(ctx.url(res.redirect));
			}

			if (res && "samlData" in res && res.samlData) {
				if (!Redirects.isSafeRedirectUri(res.samlData.url)) {
					Logger.warn("Blocked unsafe SAML post URL from login_hint resolution", {
						url: res.samlData.url,
					});
					return null;
				}
				return FlowInitiation.autoSubmitForm(res.samlData.url, res.samlData.fields);
			}

			if (res && "error" in res && res.error) {
				Logger.debug("login_hint could not be resolved, falling back to /loginname", {
					error: res.error,
				});
			}
		} catch (error) {
			Logger.error("Failed to resolve login_hint via sendLoginname:", error);
		}

		return null;
	}

	/** Sessions of the given organization (like the accounts page and findValidSession). */
	private static getEligibleSessions(sessions: Session[], organization?: string): Session[] {
		if (!organization) return sessions;
		return sessions.filter((s) => s.factors?.user?.organizationId === organization);
	}

	/** Whether the `sessions` cookie references any previous account (for the organization). */
	private static hasCookieAccount(sessionCookies: SessionCookie[], organization?: string): boolean {
		if (!sessionCookies?.length) return false;
		return sessionCookies.some(
			(c) => !!c.loginName && (!organization || c.organization === organization),
		);
	}

	private static async createCallbackRedirect(
		ctx: LoginContext,
		requestId: string,
		cookie: SessionCookie,
		headers: Record<string, string> = {},
	): Promise<{ url?: string; response?: Response }> {
		const { callbackUrl } = await ZitadelAPI.createCallback({
			serviceConfig: ctx.serviceConfig,
			req: create(CreateCallbackRequestSchema, {
				authRequestId: requestId.replace("oidc_", ""),
				callbackKind: {
					case: "session",
					value: create(SessionSchema, { sessionId: cookie.id, sessionToken: cookie.token }),
				},
			}),
		});

		if (!callbackUrl) return {};
		if (!Redirects.isSafeRedirectUri(callbackUrl)) {
			Logger.warn("Blocked unsafe OIDC callback URL", { callbackUrl });
			return { response: FlowInitiation.json(400, { error: "Unsafe redirect URI was blocked" }) };
		}
		return { url: callbackUrl, response: FlowInitiation.redirect(callbackUrl, headers) };
	}

	/** Entry point of `GET /login`. */
	static async handle(ctx: LoginContext): Promise<Response> {
		const searchParams = new URL(ctx.c.req.url).searchParams;

		// defensive: block RSC requests (parity with the Zitadel login)
		if (searchParams.has("_rsc")) {
			return FlowInitiation.json(400, { error: "RSC requests not supported" });
		}

		const requestId = FlowInitiation.validateAuthRequest(searchParams);
		if (!requestId) {
			return FlowInitiation.json(400, { error: "No valid authentication request found" });
		}

		const sessionCookies = SessionCookies.getAll(ctx);
		let sessions: Session[] = [];
		if (sessionCookies.length) {
			try {
				sessions = await LoginSessions.listFromCookies(
					ctx,
					sessionCookies.map((s) => s.id),
				);
			} catch (error) {
				// stale ids, API errors, … — treat as "no valid sessions"
				Logger.warn("Failed to load sessions", error);
				sessions = [];
			}
		}

		try {
			if (requestId.startsWith("oidc_")) {
				return await FlowInitiation.handleOIDC(ctx, requestId, sessions, sessionCookies);
			}
			if (requestId.startsWith("saml_")) {
				return await FlowInitiation.handleSAML(ctx, requestId, sessions, sessionCookies);
			}
			if (requestId.startsWith("device_")) {
				// the device flow starts at /device
				return FlowInitiation.json(400, { error: "Device authorization should use /device endpoint" });
			}
			return FlowInitiation.json(400, { error: "Invalid request ID format" });
		} catch (error) {
			Logger.error("Flow initiation failed", { requestId, error });
			return FlowInitiation.json(500, { error: "Internal server error" });
		}
	}

	static async handleOIDC(
		ctx: LoginContext,
		requestId: string,
		sessions: Session[],
		sessionCookies: SessionCookie[],
	): Promise<Response> {
		const serviceConfig = ctx.serviceConfig;

		const { authRequest } = await ZitadelAPI.getAuthRequest({
			serviceConfig,
			authRequestId: requestId.replace("oidc_", ""),
		});

		const locale = I18n.getValidLocaleFromUILocales(authRequest?.uiLocales);
		if (locale) {
			const existingLanguage = LoginCookies.getLanguage(ctx);
			if (I18n.shouldUILocalesOverrideCookie() || !existingLanguage) {
				LoginCookies.setLanguage(ctx, locale);
			}
		}

		let organization = "";
		let orgDomain = "";

		if (authRequest?.scope) {
			const orgScope = authRequest.scope.find((s) => ORG_SCOPE_REGEX.test(s));
			const idpScope = authRequest.scope.find((s) => IDP_SCOPE_REGEX.test(s));

			if (orgScope) {
				organization = ORG_SCOPE_REGEX.exec(orgScope)?.[1] ?? "";
			} else {
				const orgDomainScope = authRequest.scope.find((s) => ORG_DOMAIN_SCOPE_REGEX.test(s));
				if (orgDomainScope) {
					const scopeDomain = ORG_DOMAIN_SCOPE_REGEX.exec(orgDomainScope)?.[1] ?? "";
					Logger.info("Extracted org domain:", scopeDomain);
					if (scopeDomain) {
						const orgs = await ZitadelAPI.getOrgsByDomain({ serviceConfig, domain: scopeDomain });
						if (orgs.result && orgs.result.length === 1) {
							organization = orgs.result[0]?.id ?? "";
							orgDomain = scopeDomain;
						}
					}
				}
			}

			if (idpScope) {
				const idpId = IDP_SCOPE_REGEX.exec(idpScope)?.[1] ?? "";

				const { identityProviders } = await ZitadelAPI.getActiveIdentityProviders({
					serviceConfig,
					orgId: organization ? organization : undefined,
				});
				const idp = identityProviders.find((p) => p.id === idpId);

				if (idp) {
					if (idp.type === IdentityProviderType.LDAP) {
						// The Zitadel login redirects to `/ldap` without the idpId here, a page that does
						// not exist; the LDAP form lives at `/idp/ldap` and needs the idpId.
						const ldapUrl = ctx.url("/idp/ldap");
						ldapUrl.searchParams.set("idpId", idpId);
						ldapUrl.searchParams.set("requestId", requestId);
						if (organization) ldapUrl.searchParams.set("organization", organization);
						return FlowInitiation.redirect(ldapUrl);
					}

					const provider = IdpTypes.toSlug(idp.type);
					const params = new URLSearchParams({ requestId });
					if (organization) params.set("organization", organization);

					const response = await ZitadelAPI.startIdentityProviderFlow({
						serviceConfig,
						idpId,
						urls: {
							successUrl: ctx.url(`/idp/${provider}/process?${params}`).toString(),
							failureUrl: ctx.url(`/idp/${provider}/failure?${params}`).toString(),
							loginHint: authRequest.loginHint,
						},
					});

					if (!response?.url) {
						return FlowInitiation.json(500, { error: "Could not start IDP flow" });
					}

					// covers the form post and the redirect
					if (!Redirects.isSafeRedirectUri(response.url)) {
						Logger.warn("Blocked unsafe IdP URL", { url: response.url });
						return FlowInitiation.json(400, { error: "Unsafe redirect URI was blocked" });
					}

					if (response.fields) {
						return FlowInitiation.autoSubmitForm(response.url, response.fields);
					}

					let url = response.url;
					if (url.startsWith("/")) url = ctx.url(url).toString();
					return FlowInitiation.redirect(url);
				}
			}
		}

		if (authRequest?.prompt.includes(Prompt.CREATE)) {
			const registerUrl = ctx.url("/register");
			registerUrl.searchParams.set("requestId", requestId);
			if (organization) registerUrl.searchParams.set("organization", organization);
			return FlowInitiation.redirect(registerUrl);
		}

		// use an existing session and hydrate it for OIDC
		if (authRequest && sessions.length) {
			// pre-filter by organization so the account list is never empty
			const eligibleSessions = FlowInitiation.getEligibleSessions(sessions, organization);

			if (authRequest.prompt.includes(Prompt.SELECT_ACCOUNT)) {
				if (eligibleSessions.length === 0) {
					// keep account selection if the cookie still references a previous account (and the
					// RP passed no login_hint, which always wins over the cookie fallback)
					if (authRequest.loginHint || !FlowInitiation.hasCookieAccount(sessionCookies, organization)) {
						return FlowInitiation.gotoLoginname(ctx, {
							requestId,
							loginHint: authRequest.loginHint,
							organization,
							orgDomain,
						});
					}
				}
				return FlowInitiation.gotoAccounts(ctx, { requestId, organization, orgDomain });
			}

			if (authRequest.prompt.includes(Prompt.LOGIN)) {
				const hintResponse = await FlowInitiation.resolveLoginHint(ctx, {
					requestId,
					loginHint: authRequest.loginHint,
					organization,
				});
				if (hintResponse) return hintResponse;

				return FlowInitiation.gotoLoginname(ctx, {
					requestId,
					loginHint: authRequest.loginHint,
					organization,
					orgDomain,
				});
			}

			if (authRequest.prompt.includes(Prompt.NONE)) {
				let securitySettings: SecuritySettings | undefined;
				try {
					securitySettings = await ZitadelAPI.getSecuritySettings({ serviceConfig });
				} catch (error) {
					Logger.error("Failed to load security settings for CSP in prompt=none flow", error);
				}
				const cspHeaders = FlowInitiation.cspHeaders(ctx, securitySettings);

				const selectedSession = await LoginSessions.findValidSession({
					serviceConfig,
					sessions,
					authRequest,
					organization,
				});
				const noSession = () =>
					FlowInitiation.json(400, { error: "No active session found" }, cspHeaders);

				if (!selectedSession?.id) return noSession();

				const cookie = sessionCookies.find((c) => c.id === selectedSession.id);
				if (!cookie?.id || !cookie.token) return noSession();

				const { response } = await FlowInitiation.createCallbackRedirect(
					ctx,
					requestId,
					cookie,
					cspHeaders,
				);
				return response ?? noSession();
			}

			const selectedSession = await LoginSessions.findValidSession({
				serviceConfig,
				sessions,
				authRequest,
				organization,
			});

			if (!selectedSession?.id) {
				// login_hint matches no session: resolve it straight to the next step
				const hintResponse = await FlowInitiation.resolveLoginHint(ctx, {
					requestId,
					loginHint: authRequest.loginHint,
					organization,
				});
				if (hintResponse) return hintResponse;

				// Prefill loginname (not the account picker) for an unresolved hint or when no session
				// is eligible — unless the cookie still references a previous account (#12252).
				if (
					authRequest.loginHint ||
					(eligibleSessions.length === 0 &&
						!FlowInitiation.hasCookieAccount(sessionCookies, organization))
				) {
					return FlowInitiation.gotoLoginname(ctx, {
						requestId,
						loginHint: authRequest.loginHint,
						organization,
						orgDomain,
					});
				}
				return FlowInitiation.gotoAccounts(ctx, { requestId, organization, orgDomain });
			}

			const cookie = sessionCookies.find((c) => c.id === selectedSession.id);
			if (!cookie?.id || !cookie.token) {
				return FlowInitiation.gotoAccounts(ctx, { requestId, organization, orgDomain });
			}

			try {
				const { response } = await FlowInitiation.createCallbackRedirect(ctx, requestId, cookie);
				// the callback redirect, or a 400 for a blocked unsafe callback URL
				if (response) return response;

				Logger.info("could not create callback, redirect user to choose other account");
				return FlowInitiation.gotoAccounts(ctx, { requestId, organization, orgDomain });
			} catch (error) {
				Logger.error("Error creating callback:", error);
				return FlowInitiation.gotoAccounts(ctx, { requestId, organization, orgDomain });
			}
		}

		// No live sessions. Show the account list if the cookie still references a previous account
		// and there is no login_hint (like Login V1 after RP-initiated logout, #12252); prompt=none
		// never renders UI and prompt=login always goes to /loginname.
		if (
			!authRequest?.loginHint &&
			!authRequest?.prompt.includes(Prompt.NONE) &&
			!authRequest?.prompt.includes(Prompt.LOGIN) &&
			FlowInitiation.hasCookieAccount(sessionCookies, organization)
		) {
			return FlowInitiation.gotoAccounts(ctx, { requestId, organization, orgDomain });
		}

		const hintResponse = await FlowInitiation.resolveLoginHint(ctx, {
			requestId,
			loginHint: authRequest?.loginHint,
			organization,
		});
		if (hintResponse) return hintResponse;

		return FlowInitiation.gotoLoginname(ctx, {
			requestId,
			loginHint: authRequest?.loginHint,
			organization,
			orgDomain,
		});
	}

	static async handleSAML(
		ctx: LoginContext,
		requestId: string,
		sessions: Session[],
		sessionCookies: SessionCookie[],
	): Promise<Response> {
		const serviceConfig = ctx.serviceConfig;

		const { samlRequest } = await ZitadelAPI.getSAMLRequest({
			serviceConfig,
			samlRequestId: requestId.replace("saml_", ""),
		});

		if (!samlRequest) {
			return FlowInitiation.json(400, { error: "No samlRequest found" });
		}

		if (sessions.length === 0) {
			const loginNameUrl = ctx.url("/loginname");
			loginNameUrl.searchParams.set("requestId", requestId);
			return FlowInitiation.redirect(loginNameUrl);
		}

		const selectedSession = await LoginSessions.findValidSession({
			serviceConfig,
			sessions,
			samlRequest,
		});
		if (!selectedSession?.id) {
			return FlowInitiation.gotoAccounts(ctx, { requestId });
		}

		// the session token from the cookie authenticates the response
		const cookie = sessionCookies.find((c) => c.id === selectedSession.id);
		if (!cookie?.id || !cookie.token) {
			return FlowInitiation.gotoAccounts(ctx, { requestId });
		}

		try {
			const { url, binding } = await ZitadelAPI.createResponse({
				serviceConfig,
				req: create(CreateResponseRequestSchema, {
					samlRequestId: requestId.replace("saml_", ""),
					responseKind: { case: "session", value: { sessionId: cookie.id, sessionToken: cookie.token } },
				}),
			});

			if (url && binding.case === "redirect") {
				if (!Redirects.isSafeRedirectUri(url)) {
					Logger.warn("Blocked unsafe SAML redirect URL", { url });
					return FlowInitiation.json(400, { error: "Unsafe redirect URI was blocked" });
				}
				return FlowInitiation.redirect(url);
			}
			if (url && binding.case === "post") {
				if (!Redirects.isSafeRedirectUri(url)) {
					Logger.warn("Blocked unsafe SAML post URL", { url });
					return FlowInitiation.json(400, { error: "Unsafe redirect URI was blocked" });
				}
				return FlowInitiation.autoSubmitForm(url, {
					RelayState: binding.value.relayState,
					SAMLResponse: binding.value.samlResponse,
				});
			}
		} catch (error) {
			Logger.error("SAML createResponse failed:", error);
		}

		return FlowInitiation.gotoAccounts(ctx, { requestId });
	}
}
