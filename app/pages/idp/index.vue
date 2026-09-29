<script setup lang="ts">
/** /idp — sign in with one of the identity providers (Zitadel login: `idp/page.tsx`). */
const t = useTranslations("idp");
useSeoMeta({ title: () => t("title") });

const { requestId, organization } = useQueryParams("requestId", "organization");

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp", () =>
	useAPI((api) => api.getIdp({ query: { requestId, organization } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("title") }}</template>
		<template #description>{{ t("description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<LoginIdpButtons
			v-else-if="page?.identityProviders.length"
			:identity-providers="page.identityProviders"
			:request-id="requestId"
			:organization="organization"
			post-error-redirect-url="/idp"
			:show-label="false"
		/>
	</LoginCard>
</template>
