<script setup lang="ts">
/**
 * The login layout: one centered card on the LeiCraft_MC background, the language and theme
 * switchers and the legal links below it. Loads the translations (with the custom texts of
 * `?organization=`) before the page renders and applies the branding of the page.
 */
import { useI18nStore } from "~/composables/stores/useI18nStore";

const route = useRoute();
const i18nStore = useI18nStore();
const i18n = i18nStore.data;
const t = useTranslations("common");

useBrandingTheme();

const ready = ref(false);

function organizationOf(value: unknown) {
	return typeof value === "string" && value ? value : undefined;
}

onMounted(async () => {
	await i18nStore.setOrganization(organizationOf(route.query.organization));
	ready.value = true;
});

watch(
	() => route.query.organization,
	(organization) => i18nStore.setOrganization(organizationOf(organization)),
);

const locale = computed(() => i18n.value?.locale ?? "en");

useHead({
	htmlAttrs: {
		lang: locale,
		dir: computed(() => textDirection(locale.value)),
	},
	titleTemplate: (title) => title || t("title"),
});
</script>

<template>
	<NuxtLoadingIndicator color="var(--ui-primary)" position="top" />

	<div class="main-bg-color flex min-h-screen flex-col text-default">
		<UMain class="relative flex flex-1 flex-col">
			<div
				class="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent via-primary/5 to-transparent"
			/>
			<div class="relative flex flex-1 items-center justify-center p-4">
				<div class="flex w-full max-w-md flex-col gap-4">
					<slot v-if="ready" />
					<LoginCard v-else loading />

					<div class="flex items-center justify-between gap-4">
						<div class="flex items-center gap-2">
							<LoginLanguageSwitcher />
							<LoginThemeSwitch />
						</div>
						<LayoutFooter />
					</div>
				</div>
			</div>
		</UMain>
	</div>
</template>
