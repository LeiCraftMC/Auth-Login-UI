export namespace AppConstants {
	export const APP_NAME = "<ProjectName>";

	export const APP_ENV_PREFIX = "APPPREFIX";

	export const APP_KEYS_PREFIX = "appprefix";

	export const APP_API_DEFAULT_PORT = 12500;

	export const APP_API_DEFAULT_PROD_URL = `https://api.${AppConstants.APP_NAME.toLowerCase()}.is-on.net`;

	export const DEFAULT_EMAIL_FROM_HOST = "appname.local";

	export const DEFAULT_SMTP_FROM = `\"${AppConstants.APP_NAME}\" <noreply@${AppConstants.DEFAULT_EMAIL_FROM_HOST}>`;

	export const BINARY_NAME = "my-project-api";
}
