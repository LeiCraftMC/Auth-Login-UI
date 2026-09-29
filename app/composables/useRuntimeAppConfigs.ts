/**
 * useRuntimeAppConfigs — where the login is served. The app runs under the Zitadel login base path
 * (`app.baseURL`, default `/ui/v2/login/`, set with NUXT_APP_BASE_URL) and calls its API
 * same-origin at `<base>/api/v1`, so no public URL has to be configured.
 */
export function useRuntimeAppConfigs() {
	const baseURL = useRuntimeConfig().app.baseURL.replace(/\/+$/, "");
	return {
		/** Base path without trailing slash (`/ui/v2/login`, or `""` at the root). */
		baseURL,
		apiURL: `${baseURL}/api/v1`,
	} as const;
}
