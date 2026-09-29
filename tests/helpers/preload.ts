/// <reference types="bun-types" />

import { afterAll, beforeAll } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { API } from "../../server/lib/api";
import { LoginContext } from "../../server/lib/login/context";
import { ProtocolRoutes } from "../../server/lib/protocol";
import { ConfigHandler, type ENVConfigLike } from "../../server/lib/utils/config";
import { AppConstants } from "../../server/lib/utils/constants";
import { ZitadelClient } from "../../server/lib/zitadel/client";

/** Zitadel is never reached in tests — calls go to an in-memory router (tests/helpers/zitadel.ts). */
export const TEST_ZITADEL_URL = "http://zitadel.test";
export const TEST_PUBLIC_HOST = "login.test";

function setTestEnv() {
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

	const envVars = {
		LCMC_AUTH_LOGIN_LOG_LEVEL: "critical",

		LCMC_AUTH_LOGIN_ZITADEL_API_URL: TEST_ZITADEL_URL,
		LCMC_AUTH_LOGIN_AUDIENCE: "http://zitadel.test",
		LCMC_AUTH_LOGIN_SYSTEM_USER_ID: "login-test",
		LCMC_AUTH_LOGIN_SYSTEM_USER_PRIVATE_KEY: Buffer.from(pem).toString("base64"),
		LCMC_AUTH_LOGIN_SESSION_COOKIE_SECRET: ["test-session-cookie-secret-0123456789abcdef"],

		// the in-memory router has no security settings service state worth fetching
		LCMC_AUTH_LOGIN_API_CACHE_ENABLED: false,
	} satisfies Partial<ENVConfigLike>;

	for (const [key, value] of Object.entries(envVars)) {
		// CS.boolean(): any non-empty value is true, so `false` must be the empty string
		process.env[key] = value === false ? "" : String(value);
	}
}

beforeAll(async () => {
	setTestEnv();

	await ConfigHandler.loadConfig();

	LoginContext.configure({ basePath: AppConstants.DEFAULT_BASE_PATH });

	await API.init([], false);
	ProtocolRoutes.init();
});

afterAll(async () => {
	ZitadelClient.setTransportFactory(null);
});
