/**
 * LoginContext — the per-request state the login logic needs: the Zitadel service config for the
 * request's (virtual) instance, the public host, cookies and translations. It replaces Next's
 * `headers()` / `cookies()` / `getTranslations()` of the Zitadel login and is passed explicitly
 * to every login function.
 *
 * Cookies written during a request are visible to later reads in the same request (like Next's
 * `cookies()`), which flows such as "check password, then complete the OIDC request with the
 * session from the cookie" rely on.
 */
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { I18n } from "../i18n";
import { AppConstants } from "../utils/constants";
import { ConfigHandler } from "../utils/config";
import type { ServiceConfig, Translate } from "../zitadel/api";

function stripProtocol(url: string) {
	return url.replace(/^https?:\/\//, "");
}

export class LoginContext {
	private static basePath: string = AppConstants.DEFAULT_BASE_PATH;

	/** Base path the login is served under (`NUXT_APP_BASE_URL`), without trailing slash. */
	static configure({ basePath }: { basePath: string }) {
		LoginContext.basePath = basePath.replace(/\/+$/, "");
	}

	static getBasePath() {
		return LoginContext.basePath;
	}

	/**
	 * The host of the instance (API routing). Prefers the Zitadel proxy headers over `host`.
	 */
	static getInstanceHost(headers: Headers): string | null {
		return (
			headers.get("x-zitadel-instance-host") ||
			headers.get("x-zitadel-forward-host") ||
			headers.get("host")
		);
	}

	/** The host the user sees in the browser (never `x-zitadel-instance-host`). */
	static getPublicHost(headers: Headers): string {
		const publicHost =
			headers.get("x-zitadel-public-host") ||
			headers.get("x-zitadel-forward-host") ||
			headers.get("x-forwarded-host") ||
			headers.get("host");

		if (!publicHost) {
			throw new Error("No host found in headers");
		}
		return publicHost;
	}

	static getServiceConfig(headers: Headers): ServiceConfig {
		const baseUrl = ConfigHandler.get().ZITADEL_API_URL.replace(/\/+$/, "");
		const instanceHost = LoginContext.getInstanceHost(headers);
		let publicHost: string | null = null;
		try {
			publicHost = LoginContext.getPublicHost(headers);
		} catch {
			publicHost = null;
		}

		return {
			baseUrl,
			...(instanceHost && { instanceHost: stripProtocol(instanceHost) }),
			...(publicHost && { publicHost: stripProtocol(publicHost) }),
		};
	}

	readonly serviceConfig: ServiceConfig;

	private readonly cookieOverlay = new Map<string, string | null>();
	private resolvedI18n: Promise<I18n.Resolved> | null = null;

	constructor(readonly c: Context) {
		this.serviceConfig = LoginContext.getServiceConfig(c.req.raw.headers);
	}

	get headers(): Headers {
		return this.c.req.raw.headers;
	}

	header(name: string): string | undefined {
		return this.c.req.header(name);
	}

	publicHost(): string {
		return LoginContext.getPublicHost(this.headers);
	}

	/** `http://` for localhost, `https://` otherwise (Zitadel login: getPublicHostWithProtocol). */
	publicHostWithProtocol(): string {
		const host = this.publicHost();
		return `${host.includes("localhost") ? "http://" : "https://"}${host}`;
	}

	/** Protocol of the original request (`x-forwarded-proto` behind a proxy). */
	requestProtocol(): string {
		const forwarded = this.header("x-forwarded-proto")?.split(",")[0]?.trim();
		if (forwarded) return `${forwarded.replace(/:$/, "")}:`;
		return new URL(this.c.req.url).protocol;
	}

	/** Absolute URL of a login page (Zitadel login: constructUrl). */
	url(pathWithQuery: string): URL {
		return new URL(
			`${LoginContext.basePath}${pathWithQuery}`,
			`${this.requestProtocol()}//${this.publicHost()}`,
		);
	}

	// --- Cookies -------------------------------------------------------------------

	getCookie(name: string): string | undefined {
		if (this.cookieOverlay.has(name)) {
			return this.cookieOverlay.get(name) ?? undefined;
		}
		return getCookie(this.c, name);
	}

	setCookie(name: string, value: string, options: CookieOptions) {
		this.cookieOverlay.set(name, value);
		setCookie(this.c, name, value, options);
	}

	// --- i18n ----------------------------------------------------------------------

	/** Organization for custom texts: the `x-zitadel-i18n-organization` header or `?organization=`. */
	i18nOrganization(): string | undefined {
		return this.header("x-zitadel-i18n-organization") || this.c.req.query("organization") || undefined;
	}

	i18n(): Promise<I18n.Resolved> {
		this.resolvedI18n ??= I18n.resolve({
			serviceConfig: this.serviceConfig,
			acceptLanguage: this.header("accept-language"),
			languageCookie: this.getCookie(I18n.LANGUAGE_COOKIE_NAME),
			organization: this.i18nOrganization(),
		});
		return this.resolvedI18n;
	}

	async t(namespace: string): Promise<Translate> {
		const { messages } = await this.i18n();
		return I18n.translator(messages, namespace);
	}
}
