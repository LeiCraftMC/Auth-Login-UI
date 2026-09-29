/**
 * AppConstants — project-wide identifiers (Style-Guides templates/fullstack-nuxt-app,
 * server/lib/utils/constants.ts). See docs/03-naming-and-typescript.md.
 */
export namespace AppConstants {
	export const APP_NAME = "LeiCraftMC Auth Login";

	/** Environment-variable prefix — `ConfigHandler` reads `<prefix>_<KEY>`. */
	export const APP_ENV_PREFIX = "LCMC_AUTH_LOGIN";

	export const APP_KEYS_PREFIX = "lcmc_auth_login";

	/** Dev/prod port (12xxx range, docs/02-tooling.md — never 3000). */
	export const APP_API_DEFAULT_PORT = 12192;

	export const APP_API_DEFAULT_PROD_URL = "https://auth.leicraftmc.de/ui/v2/login/api";

	/** Default base path; Zitadel's DefaultLoginURLV2 is `/ui/v2/login/login?authRequest=`. */
	export const DEFAULT_BASE_PATH = "/ui/v2/login";

	/** The Zitadel release the login (and the generated protos) are ported from. */
	export const ZITADEL_VERSION = "v4.19.2";
}
