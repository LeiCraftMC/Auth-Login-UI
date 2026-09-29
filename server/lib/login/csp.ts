/**
 * Content-Security-Policy of the login (Zitadel login: `lib/csp.ts` + the proxy's security
 * headers). `frame-ancestors` follows the instance's embedded-iframe security settings.
 */
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { type ServiceConfig, ZitadelAPI } from "../zitadel/api";

const BASE_DIRECTIVES: Record<string, string[]> = {
	"default-src": ["'self'"],
	"script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
	"connect-src": ["'self'"],
	"style-src": ["'self'", "'unsafe-inline'"],
	"font-src": ["'self'"],
	"img-src": ["'self'"],
	"frame-ancestors": ["'none'"],
	"object-src": ["'none'"],
};

/** Static security headers (Zitadel login: next.config.mjs `secureHeaders`). */
export const SECURE_HEADERS: Record<string, string> = {
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
	"Referrer-Policy": "origin-when-cross-origin",
	"X-Content-Type-Options": "nosniff",
	"X-XSS-Protection": "1; mode=block",
};

export class LoginCSP {
	static build(options: { serviceUrl?: string; iframeOrigins?: string[] | null } = {}): string {
		const directives: Record<string, string[]> = { ...BASE_DIRECTIVES };

		if (options.serviceUrl) {
			directives["img-src"] = [...(directives["img-src"] ?? []), options.serviceUrl];
			directives["font-src"] = [...(directives["font-src"] ?? []), options.serviceUrl];
		}

		if (options.iframeOrigins && options.iframeOrigins.length > 0) {
			directives["frame-ancestors"] = [...options.iframeOrigins];
		}

		return Object.entries(directives)
			.map(([key, values]) => [key, ...values].join(" "))
			.join("; ");
	}

	/** Allowed iframe origins of the instance, or null when embedding is disabled. */
	static async getIframeOrigins(serviceConfig: ServiceConfig): Promise<string[] | null> {
		const settings = await ZitadelAPI.getSecuritySettings({ serviceConfig });
		const origins = settings?.embeddedIframe?.enabled ? settings.embeddedIframe.allowedOrigins : null;
		return origins && origins.length > 0 ? origins : null;
	}

	/** CSP (+ X-Frame-Options when framing is not allowed) for a request's instance. */
	static async headersFor(serviceConfig: ServiceConfig): Promise<Record<string, string>> {
		if (ConfigHandler.getConfig()?.CSP_FETCH_ENABLED === false) {
			return {
				"Content-Security-Policy": LoginCSP.build({ serviceUrl: serviceConfig.baseUrl }),
				"X-Frame-Options": "deny",
			};
		}

		try {
			const iframeOrigins = await LoginCSP.getIframeOrigins(serviceConfig);
			return {
				"Content-Security-Policy": LoginCSP.build({ serviceUrl: serviceConfig.baseUrl, iframeOrigins }),
				...(iframeOrigins ? {} : { "X-Frame-Options": "deny" }),
			};
		} catch (error) {
			Logger.error("Failed to load security settings for CSP, using the default CSP", error);
			return {
				"Content-Security-Policy": LoginCSP.build({ serviceUrl: serviceConfig.baseUrl }),
				"X-Frame-Options": "deny",
			};
		}
	}
}
