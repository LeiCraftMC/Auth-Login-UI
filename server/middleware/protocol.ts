import { defineEventHandler, getRequestURL, removeResponseHeader, setResponseHeaders } from "h3";
import { LoginContext } from "../lib/login/context";
import { LoginCSP, SECURE_HEADERS } from "../lib/login/csp";
import { PROBE_PATHS, ProtocolRoutes } from "../lib/protocol";
import { ConfigHandler } from "../lib/utils/config";
import { HonoBridge } from "../lib/utils/honoBridge";

/** Paths whose responses are never rendered as documents, so they skip the CSP lookup. */
const NO_CSP_PREFIXES = ["/api/", "/_nuxt/", "/_nuxt_icon/", "/__nuxt"];

/**
 * Runs for every request under the base path (Zitadel login: `proxy.ts` + next.config headers):
 *
 * 1. static security headers on every response,
 * 2. the instance's CSP (`frame-ancestors` from the embedded-iframe settings) on pages,
 * 3. `/login`, `/healthy`, `/ready` and the Zitadel proxy paths are answered by
 *    {@link ProtocolRoutes}; everything else continues to the API / Nuxt renderer.
 */
export default defineEventHandler(async (event) => {
	const path = LoginContext.stripBasePath(getRequestURL(event).pathname);

	setResponseHeaders(event, { ...SECURE_HEADERS, "X-Frame-Options": "deny" });

	const skipCsp =
		PROBE_PATHS.includes(path) ||
		NO_CSP_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
		!ConfigHandler.getConfig();

	if (!skipCsp) {
		const cspHeaders = await LoginCSP.headersFor(LoginContext.getServiceConfig(event.headers));
		if (!cspHeaders["X-Frame-Options"]) removeResponseHeader(event, "X-Frame-Options");
		setResponseHeaders(event, cspHeaders);
	}

	if (ProtocolRoutes.handles(path)) {
		return ProtocolRoutes.getApp().fetch(await HonoBridge.toRequest(event));
	}
});
