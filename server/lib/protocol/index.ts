/**
 * ProtocolRoutes — the endpoints outside `/api` whose shape is dictated by Zitadel, not by the
 * LeiCraftMC `{ success, code, message, data }` envelope:
 *
 * - `GET /login`   — flow initiation: Zitadel redirects here with `?authRequest=` / `?samlRequest=`
 * - `GET /healthy` — liveness (`{}`), `GET /ready` — readiness (Zitadel ready, cookie secret set)
 * - `/.well-known/*`, `/oauth/*`, `/oidc/*`, `/idps/callback/*`, `/saml/*`, `/assets/*` — proxied to
 *   Zitadel with the public/instance host headers, so the login domain can act as the public
 *   Zitadel host (Zitadel login: `proxy.ts`). Disable with `PROXY_ZITADEL_PATHS=false`.
 *
 * All paths are relative to the base path (`NUXT_APP_BASE_URL`, default `/ui/v2/login`), exactly
 * like the Next.js `basePath` of the Zitadel login. `server/middleware/protocol.ts` dispatches here.
 */
import { Hono } from "hono";
import { LoginContext } from "../login/context";
import { FlowInitiation } from "../login/flowInitiation";
import { SessionCookieSignature } from "../login/sessionCookieSignature";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { ZitadelClient } from "../zitadel/client";

const READINESS_TIMEOUT_MS = 5_000;

/** Paths answered without Zitadel and without CSP lookups (Kubernetes/Docker probes). */
export const PROBE_PATHS = ["/healthy", "/ready"];

/** Path prefixes forwarded to Zitadel (Zitadel login: `proxyPaths`). */
export const PROXY_PREFIXES = [
	"/.well-known/",
	"/oauth/",
	"/oidc/",
	"/idps/callback/",
	"/saml/",
	"/assets/",
];

/** Request headers that must not be forwarded to Zitadel. */
const HOP_BY_HOP_REQUEST_HEADERS = [
	"host",
	"connection",
	"content-length",
	"accept-encoding",
	"keep-alive",
];

/** Response headers that are invalid once fetch decoded the upstream body. */
const HOP_BY_HOP_RESPONSE_HEADERS = [
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
];

export class ProtocolRoutes {
	protected static app: Hono | null = null;

	static init() {
		const routes = new Hono();

		routes.get("/login", async (c) => {
			const response = await FlowInitiation.handle(LoginContext.from(c));
			// through the context, so cookies set during the flow (sessions, NEXT_LOCALE) are kept
			return c.newResponse(response.body, response);
		});

		routes.get("/healthy", (c) => c.json({}, 200));

		routes.get("/ready", () => ProtocolRoutes.ready());

		if (ProtocolRoutes.proxyEnabled()) {
			for (const prefix of PROXY_PREFIXES) {
				routes.all(`${prefix}*`, (c) => ProtocolRoutes.proxy(c.req.raw));
			}
		}

		const app = new Hono();
		app.route(LoginContext.getBasePath() || "/", routes);
		ProtocolRoutes.app = app;
	}

	static getApp(): Hono {
		if (!ProtocolRoutes.app) {
			throw new Error("Protocol routes not initialized. Call ProtocolRoutes.init() first.");
		}
		return ProtocolRoutes.app;
	}

	static proxyEnabled(): boolean {
		return ConfigHandler.getConfig()?.PROXY_ZITADEL_PATHS !== false;
	}

	/** Whether a pathname (relative to the base path) is served by these routes. */
	static handles(path: string): boolean {
		if (path === "/login" || PROBE_PATHS.includes(path)) return true;
		return ProtocolRoutes.proxyEnabled() && PROXY_PREFIXES.some((prefix) => path.startsWith(prefix));
	}

	/**
	 * 503 without a Zitadel API URL, without a usable cookie secret, or when Zitadel's
	 * `/debug/ready` fails (Zitadel login: `app/ready/route.ts`).
	 */
	static async ready(): Promise<Response> {
		const unavailable = () =>
			new Response("Service unavailable", {
				status: 503,
				headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
			});

		const apiUrl = ConfigHandler.getConfig()?.ZITADEL_API_URL;
		if (!apiUrl) return unavailable();

		// without a signing secret every login fails as soon as the session cookie is written
		if (!SessionCookieSignature.hasSecret()) {
			Logger.error(
				`Readiness check failed: ${SessionCookieSignature.getConfigError() ?? "no session cookie signing secret available (set SESSION_COOKIE_SECRET)"}`,
			);
			return unavailable();
		}

		try {
			const headers = new Headers();
			ZitadelClient.applyCustomHeaders({
				set: (key, value) => headers.set(key, value),
				remove: (key) => headers.delete(key),
			});

			// unauthenticated and not counted against the instance quota
			const response = await fetch(new URL("/debug/ready", apiUrl), {
				method: "GET",
				headers,
				signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
			});
			await response.arrayBuffer().catch(() => undefined);

			if (!response.ok) {
				throw new Error(`Zitadel readiness check returned HTTP ${response.status}`);
			}

			return new Response("OK", {
				status: 200,
				headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
			});
		} catch (error) {
			Logger.error("Readiness check failed", error);
			return unavailable();
		}
	}

	/** Forwards a request to Zitadel as the public host (Zitadel login: `proxy.ts` rewrite). */
	static async proxy(request: Request): Promise<Response> {
		const serviceConfig = LoginContext.getServiceConfig(request.headers);
		const url = new URL(request.url);
		const path = LoginContext.stripBasePath(url.pathname);

		const headers = new Headers(request.headers);
		for (const header of HOP_BY_HOP_REQUEST_HEADERS) headers.delete(header);
		if (serviceConfig.publicHost) headers.set("x-zitadel-public-host", serviceConfig.publicHost);
		if (serviceConfig.instanceHost) {
			headers.set("x-zitadel-instance-host", serviceConfig.instanceHost);
		}
		ZitadelClient.applyCustomHeaders({
			set: (key, value) => headers.set(key, value),
			remove: (key) => headers.delete(key),
		});

		const hasBody = request.method !== "GET" && request.method !== "HEAD";
		const upstream = await fetch(`${serviceConfig.baseUrl}${path}${url.search}`, {
			method: request.method,
			headers,
			body: hasBody ? await request.arrayBuffer() : undefined,
			redirect: "manual",
		});

		const responseHeaders = new Headers(upstream.headers);
		for (const header of HOP_BY_HOP_RESPONSE_HEADERS) responseHeaders.delete(header);
		responseHeaders.set("Access-Control-Allow-Origin", "*");
		responseHeaders.set("Access-Control-Allow-Headers", "*");

		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders,
		});
	}

	/** Test helper. */
	static reset() {
		ProtocolRoutes.app = null;
	}
}
