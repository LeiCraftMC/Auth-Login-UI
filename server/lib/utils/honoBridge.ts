import { getMethod, getRequestURL, type H3Event, readRawBody } from "h3";

/**
 * HonoBridge — turns a Nitro (h3) event into a web `Request` for a Hono app.
 *
 * The URL keeps the full path including the Nuxt base path (`NUXT_APP_BASE_URL`), so the Hono
 * apps are mounted under it and redirects built from `c.req.path` stay correct. Bodies are read
 * as raw bytes, so binary and form payloads are forwarded unchanged.
 */
export class HonoBridge {
	static async toRequest(event: H3Event): Promise<Request> {
		const method = getMethod(event);
		const body = method !== "GET" && method !== "HEAD" ? await readRawBody(event, false) : undefined;

		return new Request(getRequestURL(event), {
			method,
			headers: event.headers,
			body: body ? new Uint8Array(body) : undefined,
		});
	}
}
