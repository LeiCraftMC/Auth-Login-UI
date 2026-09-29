/**
 * I18n — the login's translations (port of the Zitadel login's `i18n/request.ts` + `lib/i18n.ts`).
 *
 * Messages are the Zitadel login's locale files (`./locales`, copied verbatim), deep-merged as
 * `en` → locale → brand overlay → the instance/organization's custom texts from Zitadel
 * (`GetHostedLoginTranslation`). The locale is resolved per request exactly like the Zitadel
 * login: instance default language, then `Accept-Language`, then the `NEXT_LOCALE` cookie, all
 * restricted to the instance's allowed languages.
 */
import { ZitadelAPI } from "../zitadel/api";
import type { ServiceConfig, Translate } from "../zitadel/api";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import ar from "./locales/ar.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import hu from "./locales/hu.json";
import it from "./locales/it.json";
import ja from "./locales/ja.json";
import nl from "./locales/nl.json";
import pl from "./locales/pl.json";
import pt from "./locales/pt.json";
import ru from "./locales/ru.json";
import tr from "./locales/tr.json";
import uk from "./locales/uk.json";
import zh from "./locales/zh.json";

export namespace I18n {
	export interface Lang {
		name: string;
		code: string;
	}

	export type Messages = { [key: string]: string | Messages };

	export interface Resolved {
		locale: string;
		languages: Lang[];
		messages: Messages;
	}
}

const LOCALE_MESSAGES: Record<string, I18n.Messages> = {
	ar,
	de,
	en,
	es,
	fr,
	hu,
	it,
	ja,
	nl,
	pl,
	pt,
	ru,
	tr,
	uk,
	zh,
};

/** Messages whose built-in text names Zitadel as the product; rebranded to APPLICATION_NAME. */
const BRANDED_MESSAGE_PATHS = [
	["common", "title"],
	["register", "description"],
	["device", "request", "disclaimer"],
];

export class I18n {
	static readonly FALLBACK = "en";

	/** Cookie name used by the Zitadel login (next-intl), kept for compatibility. */
	static readonly LANGUAGE_COOKIE_NAME = "NEXT_LOCALE";

	static readonly LANGS: I18n.Lang[] = [
		{ name: "English", code: "en" },
		{ name: "Deutsch", code: "de" },
		{ name: "Italiano", code: "it" },
		{ name: "Español", code: "es" },
		{ name: "Français", code: "fr" },
		{ name: "Nederlands", code: "nl" },
		{ name: "Polski", code: "pl" },
		{ name: "Português", code: "pt" },
		{ name: "简体中文", code: "zh" },
		{ name: "Русский", code: "ru" },
		{ name: "Magyar", code: "hu" },
		{ name: "Türkçe", code: "tr" },
		{ name: "日本語", code: "ja" },
		{ name: "Українська", code: "uk" },
		{ name: "العربية", code: "ar" },
	];

	static isValidLanguage(code: string) {
		const normalized = code.trim().toLowerCase();
		return I18n.LANGS.some((lang) => lang.code === normalized);
	}

	/** First supported language of an OIDC `ui_locales` list (`de-CH` → `de`), or null. */
	static getValidLocaleFromUILocales(uiLocales: string[] | undefined): string | null {
		if (!uiLocales || uiLocales.length === 0) return null;

		for (const locale of uiLocales) {
			const normalized = locale.trim().toLowerCase();
			if (I18n.isValidLanguage(normalized)) return normalized;

			const languageCode = normalized.split("-")[0] ?? "";
			if (I18n.isValidLanguage(languageCode)) return languageCode;
		}
		return null;
	}

	static shouldUILocalesOverrideCookie() {
		return ConfigHandler.getConfig()?.UI_LOCALES_OVERRIDE_COOKIE === true;
	}

	static getLanguage(code: string): I18n.Lang {
		const lang = I18n.LANGS.find((l) => l.code === code);
		if (lang) return lang;
		return { code, name: new Intl.DisplayNames([code], { type: "language" }).of(code) || code };
	}

	static deepMerge(...sources: (I18n.Messages | undefined)[]): I18n.Messages {
		const result: I18n.Messages = {};
		for (const source of sources) {
			if (!source) continue;
			for (const [key, value] of Object.entries(source)) {
				const existing = result[key];
				if (
					value &&
					typeof value === "object" &&
					!Array.isArray(value) &&
					existing &&
					typeof existing === "object"
				) {
					result[key] = I18n.deepMerge(existing, value);
				} else if (value && typeof value === "object" && !Array.isArray(value)) {
					result[key] = I18n.deepMerge(value);
				} else if (value !== undefined && value !== null) {
					result[key] = value;
				}
			}
		}
		return result;
	}

	private static applyBrand(messages: I18n.Messages) {
		const appName = ConfigHandler.getConfig()?.APPLICATION_NAME;
		if (!appName) return messages;

		for (const path of BRANDED_MESSAGE_PATHS) {
			let node: I18n.Messages | string | undefined = messages;
			for (const segment of path.slice(0, -1)) {
				node = typeof node === "object" ? node[segment] : undefined;
			}
			const last = path[path.length - 1] as string;
			if (node && typeof node === "object" && typeof node[last] === "string") {
				node[last] = (node[last] as string).replaceAll("Zitadel", appName);
			}
		}
		return messages;
	}

	/** Built-in messages for `locale`, falling back to `defaultLanguage` and English. */
	static builtInMessages(locale: string, defaultLanguage = I18n.FALLBACK) {
		const localeMessages =
			LOCALE_MESSAGES[locale] ?? LOCALE_MESSAGES[defaultLanguage] ?? LOCALE_MESSAGES[I18n.FALLBACK];
		return I18n.applyBrand(I18n.deepMerge(LOCALE_MESSAGES[I18n.FALLBACK], localeMessages));
	}

	/**
	 * Resolves locale, selectable languages and merged messages for a request. `organization`
	 * selects organization-level custom texts (Zitadel login: `x-zitadel-i18n-organization`).
	 */
	static async resolve({
		serviceConfig,
		acceptLanguage,
		languageCookie,
		organization,
	}: {
		serviceConfig: ServiceConfig;
		acceptLanguage?: string | null;
		languageCookie?: string | null;
		organization?: string | null;
	}): Promise<I18n.Resolved> {
		let allowedLanguages = I18n.LANGS.map((l) => l.code);
		let defaultLanguage = I18n.FALLBACK;

		try {
			const settings = await ZitadelAPI.getAllowedLanguages({ serviceConfig });
			if (settings.allowedLanguages?.length) {
				const local = I18n.LANGS.map((l) => l.code);
				allowedLanguages = settings.allowedLanguages.filter((l) => local.includes(l));
			}
			if (settings.defaultLanguage) {
				defaultLanguage = settings.defaultLanguage;
			}
		} catch (error) {
			Logger.warn("Failed to load the allowed languages:", error);
		}

		let locale = defaultLanguage;

		if (acceptLanguage) {
			// "en-US,en;q=0.9" → "en"
			const headerLocale = acceptLanguage.split(",")[0]?.split("-")[0] ?? "";
			if (allowedLanguages.includes(headerLocale)) {
				locale = headerLocale;
			}
		}

		if (languageCookie) {
			// A cookie with an unsupported language falls back to the default language.
			locale = allowedLanguages.includes(languageCookie) ? languageCookie : defaultLanguage;
		}

		let customMessages: I18n.Messages = {};
		try {
			const custom = await ZitadelAPI.getHostedLoginTranslation({
				serviceConfig,
				locale,
				organization: organization || undefined,
			});
			if (custom) customMessages = custom as I18n.Messages;
		} catch (error) {
			Logger.warn("Failed to load custom translations:", error);
		}

		const languages = allowedLanguages.length
			? I18n.LANGS.filter((l) => allowedLanguages.includes(l.code))
			: I18n.LANGS;

		return {
			locale,
			languages,
			messages: I18n.deepMerge(I18n.builtInMessages(locale, defaultLanguage), customMessages),
		};
	}

	/** Replaces `{name}` placeholders (the only ICU syntax the locale files use). */
	static format(message: string, data?: Record<string, string | number | undefined>) {
		if (!data) return message;
		return message.replace(/\{(\w+)\}/g, (match, name: string) =>
			name in data ? String(data[name] ?? "") : match,
		);
	}

	/** A `t(key, data)` for one namespace; unknown keys render as `namespace.key` (like next-intl). */
	static translator(messages: I18n.Messages, namespace?: string): Translate {
		return (key, data) => {
			const fullKey = namespace ? `${namespace}.${key}` : key;
			let node: I18n.Messages | string | undefined = messages;
			for (const segment of fullKey.split(".")) {
				node = typeof node === "object" ? node[segment] : undefined;
			}
			return typeof node === "string" ? I18n.format(node, data) : fullKey;
		};
	}
}
