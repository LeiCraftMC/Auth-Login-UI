/**
 * Message lookup for the Zitadel login translations (the same JSON the server resolves in
 * server/lib/i18n: locale file + Zitadel custom texts). Messages use simple `{name}`
 * placeholders; a missing key renders as `namespace.key`, like next-intl in the Zitadel login.
 */
export type LoginMessages = { [key: string]: LoginMessages | string };

export type TranslateData = Record<string, string | number | undefined>;

export function formatMessage(message: string, data?: TranslateData) {
	if (!data) return message;
	return message.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in data ? String(data[name] ?? "") : match,
	);
}

export function translateMessage(
	messages: LoginMessages | null | undefined,
	namespace: string | undefined,
	key: string,
	data?: TranslateData,
): string {
	const fullKey = namespace ? `${namespace}.${key}` : key;
	let node: LoginMessages | string | undefined = messages ?? undefined;
	for (const segment of fullKey.split(".")) {
		node = typeof node === "object" ? node[segment] : undefined;
	}
	return typeof node === "string" ? formatMessage(node, data) : fullKey;
}

/** Languages written right-to-left (of the ones the Zitadel login ships). */
const RTL_LANGUAGES = new Set(["ar"]);

export function textDirection(locale: string): "rtl" | "ltr" {
	return RTL_LANGUAGES.has(locale.split("-")[0] ?? locale) ? "rtl" : "ltr";
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 60 * 60 * 1000],
	["month", 30 * 24 * 60 * 60 * 1000],
	["day", 24 * 60 * 60 * 1000],
	["hour", 60 * 60 * 1000],
	["minute", 60 * 1000],
	["second", 1000],
];

/** "5 minutes ago" / "in 2 hours" in the given locale (moment's `fromNow` in the Zitadel login). */
export function formatRelativeTime(timestampMs: number, locale: string, now = Date.now()) {
	const diff = timestampMs - now;
	const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	for (const [unit, ms] of RELATIVE_UNITS) {
		if (Math.abs(diff) >= ms || unit === "second") {
			return format.format(Math.round(diff / ms), unit);
		}
	}
	return format.format(0, "second");
}
