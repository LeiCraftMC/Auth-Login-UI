import { readFileSync } from "node:fs";
import { z } from "zod";
import { AppConstants } from "./constants";
import { Logger } from "./logger";

interface ConfigSchemaSettings {
	[key: string]: CS.ConfigItem<z.ZodType>;
}

type ConfigLike<T extends ConfigSchemaSettings> = {
	[K in keyof T]: z.infer<T[K]["_schema"]>;
};

class CS {
	private constructor() {}

	static string() {
		return new CS.ConfigItem(z.string());
	}

	static number() {
		return new CS.ConfigItem(z.coerce.number());
	}

	static boolean() {
		return new CS.ConfigItem(z.coerce.boolean());
	}

	static enum<const T extends readonly string[]>(values: T) {
		return new CS.ConfigItem(z.enum(values));
	}

	static array() {
		return new CS.ConfigItem(
			z.string().transform<string[]>((val) => {
				if (typeof val === "string") {
					return val
						.split(",")
						.map((v) => v.trim())
						.filter(Boolean);
				}
				return [];
			}),
		);
	}
}

namespace CS {
	export class ConfigItem<const Schema extends z.ZodType> {
		constructor(public _schema: Schema) {}

		public parse(value: unknown) {
			return this._schema.safeParse(value);
		}

		public default(value: z.util.NoUndefined<z.core.output<Schema>>) {
			this._schema = this._schema.default(value) as any;
			return this as any as ConfigItem<z.ZodDefault<Schema>>;
		}

		public optional() {
			this._schema = this._schema.optional() as any;
			return this as any as ConfigItem<z.ZodOptional<Schema>>;
		}
	}
}

class ConfigSchema<T extends ConfigSchemaSettings> {
	readonly schema: T;

	constructor(schema: T) {
		this.schema = schema;
	}

	public parse() {
		const result: ConfigLike<T> = {} as ConfigLike<T>;

		for (const [key, settings] of Object.entries(this.schema)) {
			const value = process.env[`${AppConstants.APP_ENV_PREFIX}_${key}`];

			const parseResult = settings.parse(value);
			if (!parseResult.success) {
				Logger.error(
					`Failed to read the environment variable ${key}: ${parseResult.error.issues[0]?.message}`,
				);
				process.exit(1);
			}

			// Store the parsed (coerced/defaulted) value, not the raw env string —
			// otherwise numbers/booleans stay strings and defaults/optionals are lost.
			(result[key] as any) = parseResult.data;
		}
		return result;
	}
}

export type ENVConfigLike = {
	[K in Extract<
		keyof typeof ConfigHandler.schema.schema,
		string
	> as `${typeof AppConstants.APP_ENV_PREFIX}_${K}`]: z.infer<
		(typeof ConfigHandler.schema.schema)[K]["_schema"]
	>;
};

export type ParsedConfig = ConfigLike<typeof ConfigHandler.schema.schema>;

export class ConfigHandler {
	// Public so ENVConfigLike / ParsedConfig can derive from it without @ts-expect-error.
	// Treat it as read-only.
	static schema = new ConfigSchema({
		LOG_LEVEL: CS.enum(["debug", "info", "warn", "error", "critical"]).default("info"),

		API_DISABLE_DOCS: CS.boolean().default(false),

		// --- Zitadel -------------------------------------------------------------
		// Base URL of the Zitadel API the login talks to (Zitadel login: ZITADEL_API_URL). With
		// virtual instances the instance is picked per request via `x-zitadel-instance-host`.
		ZITADEL_API_URL: CS.string(),

		// System API user (Zitadel login: AUDIENCE, SYSTEM_USER_ID, SYSTEM_USER_PRIVATE_KEY(_FILE)).
		// The only supported authentication — see server/lib/zitadel/systemToken.ts.
		AUDIENCE: CS.string(),
		SYSTEM_USER_ID: CS.string(),
		// PEM (PKCS#1 or PKCS#8), either base64-encoded (as the Zitadel login expects) or raw.
		SYSTEM_USER_PRIVATE_KEY: CS.string().optional(),
		SYSTEM_USER_PRIVATE_KEY_FILE: CS.string().optional(),

		// Secret(s) for signing the `sessions` cookie, comma-separated for rotation (first signs,
		// all verify), each at least 32 characters (Zitadel login: ZITADEL_SESSION_COOKIE_SECRET).
		SESSION_COOKIE_SECRET: CS.array().optional(),

		// `key:value` pairs added to every Zitadel request, comma-separated; an empty value removes
		// the header (Zitadel login: CUSTOM_REQUEST_HEADERS).
		CUSTOM_REQUEST_HEADERS: CS.string().optional(),

		// --- Login behaviour -----------------------------------------------------
		// Overrides the redirect after a login without an OIDC/SAML request; a value starting with
		// "/" is resolved against the public host (Zitadel login: DEFAULT_REDIRECT_URI).
		DEFAULT_REDIRECT_URI: CS.string().optional(),
		// Require a verified email before a session counts as valid (Zitadel login: EMAIL_VERIFICATION).
		EMAIL_VERIFICATION: CS.boolean().default(false),
		// Submit verification codes from email links automatically (NEXT_PUBLIC_AUTO_SUBMIT_CODE).
		AUTO_SUBMIT_CODE: CS.boolean().default(false),
		// Let `ui_locales` of an auth request override an existing language cookie
		// (Zitadel login: ZITADEL_UI_LOCALES_OVERRIDE_COOKIE).
		UI_LOCALES_OVERRIDE_COOKIE: CS.boolean().default(false),
		// Application name shown in invite emails (NEXT_PUBLIC_APPLICATION_NAME).
		APPLICATION_NAME: CS.string().default("LeiCraft_MC Auth"),

		// --- Caching & security --------------------------------------------------
		// In-memory stale-while-revalidate cache for settings lookups (API_CACHE_ENABLED /
		// API_CACHE_CONFIG, e.g. '{"defaultMinutes":15,"longMinutes":60,"maxSize":200}').
		API_CACHE_ENABLED: CS.boolean().default(true),
		API_CACHE_CONFIG: CS.string().optional(),
		// Fetch the instance security settings to build frame-ancestors (CSP_FETCH_ENABLED).
		CSP_FETCH_ENABLED: CS.boolean().default(true),
		// Proxy /.well-known, /oauth, /oidc, /idps/callback, /saml and /assets to Zitadel so the
		// login domain can act as the public Zitadel host.
		PROXY_ZITADEL_PATHS: CS.boolean().default(true),
		// Additional origins allowed to call the API with cookies (CORS + CSRF origin check)
		// (Zitadel login: SERVER_ACTION_ALLOWED_ORIGINS).
		ALLOWED_ORIGINS: CS.array().optional(),
	});

	private static config: ParsedConfig | null = null;

	/** You have to call {@link ConfigHandler.loadConfig} before trying to access the config. */
	static getConfig() {
		return this.config;
	}

	/** Like {@link getConfig}, but throws when the config was not loaded yet. */
	static get() {
		if (!this.config) {
			throw new Error("Config not loaded. Call ConfigHandler.loadConfig() first.");
		}
		return this.config;
	}

	static async loadConfig() {
		if (this.config) return this.config;
		this.config = this.schema.parse();
		return this.config;
	}

	/** Test helper: drop the parsed config so the next `loadConfig()` re-reads the environment. */
	static reset() {
		this.config = null;
	}

	/**
	 * The system user's private key as PEM. `SYSTEM_USER_PRIVATE_KEY` wins (base64-encoded like
	 * the Zitadel login expects, or a raw PEM with literal `\n`), otherwise the file is read.
	 */
	static resolveSystemUserPrivateKey(): string {
		const config = ConfigHandler.get();
		const inline = config.SYSTEM_USER_PRIVATE_KEY;
		if (inline) {
			if (inline.includes("-----BEGIN")) {
				return inline.replace(/\\n/g, "\n");
			}
			return Buffer.from(inline, "base64").toString("utf-8");
		}
		if (config.SYSTEM_USER_PRIVATE_KEY_FILE) {
			return readFileSync(config.SYSTEM_USER_PRIVATE_KEY_FILE, "utf-8");
		}
		throw new Error(
			`${AppConstants.APP_ENV_PREFIX}_SYSTEM_USER_PRIVATE_KEY or ${AppConstants.APP_ENV_PREFIX}_SYSTEM_USER_PRIVATE_KEY_FILE must be set.`,
		);
	}

	/**
	 * The configured credential as the Zitadel login uses it for the deprecated session-cookie
	 * signing fallback: the raw env value, or the trimmed key file content.
	 */
	static resolveCredentialSecret(): string | undefined {
		const config = ConfigHandler.get();
		if (config.SYSTEM_USER_PRIVATE_KEY) return config.SYSTEM_USER_PRIVATE_KEY;
		if (config.SYSTEM_USER_PRIVATE_KEY_FILE) {
			try {
				return readFileSync(config.SYSTEM_USER_PRIVATE_KEY_FILE, "utf-8").trim() || undefined;
			} catch {
				return undefined;
			}
		}
		return undefined;
	}
}
