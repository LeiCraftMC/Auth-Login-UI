<script setup lang="ts">
/** /logout/done — the session was ended (Zitadel login: `logout/done/page.tsx`). */
const t = useTranslations("logout");
useSeoMeta({ title: () => t("success.title") });

const organization = useQueryParam("organization");

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("logout-done", () =>
	useAPI((api) => api.getSettingsBranding({ query: { organization } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("success.title") }}</template>
		<template #description>{{ t("success.description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>
	</LoginCard>
</template>
