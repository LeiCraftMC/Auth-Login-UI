<script setup lang="ts">
/**
 * /idp/[provider]/registration-failed — the organization for an IdP registration could not be
 * determined (Zitadel login: `idp/[provider]/registration-failed/page.tsx`).
 */
const t = useTranslations("idp");
useSeoMeta({ title: () => t("registrationFailed.title") });

const { organization, postErrorRedirectUrl } = useQueryParams(
	"organization",
	"postErrorRedirectUrl",
);

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp-registration-failed", () =>
	useAPI((api) => api.getSettingsBranding({ query: { organization, fallbackToDefault: "true" } })),
);

// only login pages: the parameter comes from the URL
const backLink =
	postErrorRedirectUrl && !isExternalUrl(postErrorRedirectUrl) ? postErrorRedirectUrl : "";
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("registrationFailed.title") }}</template>
		<template #description>{{ t("registrationFailed.description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else class="flex flex-col items-center gap-4">
			<LoginAlert class="w-full">{{ t("registrationFailed.info") }}</LoginAlert>
			<UButton v-if="backLink" :to="backLink" block>{{ t("registrationFailed.backToLogin") }}</UButton>
		</div>
	</LoginCard>
</template>
