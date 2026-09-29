/**
 * useTranslations — `t(key, data?)` for one namespace of the Zitadel login messages (the
 * next-intl API the Zitadel login uses): `const t = useTranslations("loginname"); t("title")`.
 * Reactive: templates re-render when the language or the organization's custom texts change.
 */
import { useI18nStore } from "~/composables/stores/useI18nStore";

export function useTranslations(namespace?: string) {
	const i18n = useI18nStore().data;
	return (key: string, data?: TranslateData) =>
		translateMessage(i18n.value?.messages as LoginMessages | undefined, namespace, key, data);
}

/** The active locale (`en` until the translations are loaded). */
export function useLoginLocale() {
	const i18n = useI18nStore().data;
	return computed(() => i18n.value?.locale ?? "en");
}
