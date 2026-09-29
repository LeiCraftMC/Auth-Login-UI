<script setup lang="ts">
/**
 * Language selection (Zitadel login: `LanguageSwitcher`): the instance's allowed languages; the
 * choice is stored in the `NEXT_LOCALE` cookie and the texts are reloaded.
 */
import { useI18nStore } from "~/composables/stores/useI18nStore";

const i18nStore = useI18nStore();
const i18n = i18nStore.data;
const loading = ref(false);

const items = computed(() =>
	(i18n.value?.languages ?? []).map((language) => ({ label: language.name, value: language.code })),
);

const selected = computed({
	get: () => i18n.value?.locale,
	set: async (language) => {
		if (!language || language === i18n.value?.locale) return;
		loading.value = true;
		await i18nStore.setLanguage(language);
		loading.value = false;
	},
});
</script>

<template>
	<USelect
		v-if="items.length > 1"
		v-model="selected"
		:items="items"
		:loading="loading"
		icon="i-lucide-languages"
		size="sm"
		color="neutral"
		variant="subtle"
		class="w-40"
		aria-label="Language"
	/>
	<span v-else />
</template>
