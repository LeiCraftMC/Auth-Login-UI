import { sanitizeUrl } from "@braintree/sanitize-url";

/**
 * decodeURIComponent that never throws. A malformed escape (e.g. a literal "%")
 * in a route param would otherwise raise a URIError during page setup and surface
 * as an SSR 500 instead of a clean 404. Falls back to the raw value.
 */
export function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Relative paths (`/…`, not `//…`) are internal; everything else (absolute, custom schemes) is external. */
export function isExternalUrl(url: string): boolean {
	return !(url.startsWith("/") && !url.startsWith("//"));
}

const SANITIZE_BLANK = "about:blank";
const EXTRA_BLOCKED = new Set(["file:", "blob:", "about:"]);

/**
 * Whether a redirect target from the API may be followed: relative paths, or absolute URLs /
 * custom schemes that are not `javascript:`, `data:`, `file:`, `blob:` or `about:`
 * (Zitadel login: `lib/client-utils.ts`).
 */
export function isSafeRedirectUri(uri: string): boolean {
	if (!uri) return false;
	if (!isExternalUrl(uri)) return true;

	const sanitized = sanitizeUrl(uri);
	if (sanitized === SANITIZE_BLANK) return false;

	try {
		return !EXTRA_BLOCKED.has(new URL(sanitized).protocol);
	} catch {
		return false;
	}
}

/** Builds a query string from the defined values (`undefined`, `null` and `""` are skipped). */
export function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
	}
	return search.toString();
}

/** A login path with query, e.g. `loginPath("/password", { loginName })` → `/password?loginName=…`. */
export function loginPath(
	path: string,
	params: Record<string, string | number | boolean | null | undefined>,
) {
	const query = buildQuery(params);
	return query ? `${path}?${query}` : path;
}

/** Replaces the `{{.Lang}}` placeholder of Zitadel's legal links with the current locale. */
export function resolveLocalizedLegalLink(link: string | undefined, locale: string | undefined) {
	if (!link || !locale) return link;
	return link.replaceAll("{{.Lang}}", locale);
}
