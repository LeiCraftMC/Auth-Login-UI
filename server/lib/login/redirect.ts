/**
 * Redirect validation (Zitadel login: `isSafeRedirectUri` / `isExternalUrl` in
 * `lib/client-utils.ts`). The same checks run in the browser (`app/utils/redirect.ts`).
 */
import { sanitizeUrl } from "@braintree/sanitize-url";

const SANITIZE_BLANK = "about:blank";
const EXTRA_BLOCKED = new Set(["file:", "blob:", "about:"]);

export class Redirects {
	/** Relative paths (`/…`, not `//…`) are internal; everything else is external. */
	static isExternalUrl(url: string): boolean {
		return !(url.startsWith("/") && !url.startsWith("//"));
	}

	/**
	 * Relative paths and absolute URLs without a dangerous scheme (javascript:, data:, vbscript:,
	 * file:, blob:, about:) are safe. Prevents XSS via redirect targets.
	 */
	static isSafeRedirectUri(uri: string): boolean {
		if (!uri) return false;
		if (uri.startsWith("/") && !uri.startsWith("//")) return true;

		const sanitized = sanitizeUrl(uri);
		if (sanitized === SANITIZE_BLANK) return false;

		try {
			return !EXTRA_BLOCKED.has(new URL(sanitized).protocol);
		} catch {
			return false;
		}
	}
}
