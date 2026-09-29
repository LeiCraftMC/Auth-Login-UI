/**
 * updateAPIClient — point the generated SDK at the same-origin API.
 *
 * The login state lives in httpOnly cookies, so there is no token to attach. The organization of
 * the page is sent as `x-zitadel-i18n-organization` so translated error messages use its custom
 * texts (the Zitadel login's proxy sets the same header from `?organization=`).
 *
 * The generated client is `@hey-api/client-fetch` (like LAVIAC — client-nuxt's generated code
 * fails vue-tsc here, see `openapi-ts.config.ts`). It resolves to `{ data?, error?, … }`;
 * `useAPI` unwraps the `{ success, code, message, data }` envelope. `throwOnError: false` returns
 * non-2xx responses instead of throwing.
 */
import { client } from "@/api-client/client.gen";
import { useRuntimeAppConfigs } from "./useRuntimeAppConfigs";

export function updateAPIClient(i18nOrganization?: string) {
	client.setConfig({
		baseUrl: useRuntimeAppConfigs().apiURL,
		credentials: "same-origin",
		headers: { "x-zitadel-i18n-organization": i18nOrganization || null },
		throwOnError: false,
	});
}
