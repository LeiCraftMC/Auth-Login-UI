import { defineNitroPlugin, useRuntimeConfig } from "nitropack/runtime";
import { API } from "../lib/api";
import { LoginContext } from "../lib/login/context";
import { SessionCookieSignature } from "../lib/login/sessionCookieSignature";
import { ProtocolRoutes } from "../lib/protocol";
import { ConfigHandler } from "../lib/utils/config";
import { AppConstants } from "../lib/utils/constants";
import { Logger } from "../lib/utils/logger";
import { ZitadelSystemToken } from "../lib/zitadel/systemToken";

// Runs once at Nitro boot — replaces Main.main() from the standalone backend shape.
export default defineNitroPlugin(async (nitroApp) => {
	const config = await ConfigHandler.loadConfig();

	Logger.setLogLevel(config.LOG_LEVEL ?? "info");
	Logger.log(`Starting ${AppConstants.APP_NAME} (Zitadel login ${AppConstants.ZITADEL_VERSION})...`);

	LoginContext.configure({ basePath: useRuntimeConfig().app.baseURL });

	// Surface a broken system-user key at boot instead of on the first login attempt.
	try {
		await ZitadelSystemToken.get();
	} catch (error) {
		Logger.error("Could not create the Zitadel system-user token:", error);
	}

	const cookieNotice = SessionCookieSignature.getStartupNotice();
	if (cookieNotice) {
		Logger[cookieNotice.level](cookieNotice.message);
	}

	await API.init(config.ALLOWED_ORIGINS ?? [], config.API_DISABLE_DOCS === true);
	ProtocolRoutes.init();

	Logger.log(`${AppConstants.APP_NAME} is serving ${LoginContext.getBasePath() || "/"}`);

	nitroApp.hooks.hook("close", async () => {
		Logger.log("Received SIGTERM, shutting down...");
	});
});
