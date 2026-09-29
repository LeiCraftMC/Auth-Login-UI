<script setup lang="ts">
/** /idp/[provider]/linking-failed — linking the IdP failed (Zitadel login: `linking-failed/page.tsx`). */
const t = useTranslations("idp");
useSeoMeta({ title: () => t("title") });

const { organization, error } = useQueryParams("organization", "error");

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp-linking-failed", () =>
	useAPI((api) => api.getSettingsBranding({ query: { organization } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("title") }}</template>
		<template #description>{{ t("errors.linkingFailed") }}</template>
		<template v-if="error" #header>
			<p class="text-sm text-error">{{ error }}</p>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>
	</LoginCard>
</template>
