<script setup lang="ts">
/**
 * /idp/[provider]/account-not-found — the IdP user has no account and none may be created
 * (Zitadel login: `idp/[provider]/account-not-found/page.tsx`).
 */
const t = useTranslations("idp");
useSeoMeta({ title: () => t("accountNotFound.title") });

const { organization, postErrorRedirectUrl } = useQueryParams(
	"organization",
	"postErrorRedirectUrl",
);

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp-account-not-found", () =>
	useAPI((api) => api.getSettingsBranding({ query: { organization, fallbackToDefault: "true" } })),
);

// only login pages: the parameter comes from the URL
const backLink =
	postErrorRedirectUrl && !isExternalUrl(postErrorRedirectUrl) ? postErrorRedirectUrl : "";
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("accountNotFound.title") }}</template>
		<template #description>{{ t("accountNotFound.description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else class="flex flex-col items-center gap-4">
			<LoginAlert type="info" class="w-full">{{ t("accountNotFound.info") }}</LoginAlert>
			<UButton v-if="backLink" :to="backLink" block>{{ t("accountNotFound.backToLogin") }}</UButton>
		</div>
	</LoginCard>
</template>
