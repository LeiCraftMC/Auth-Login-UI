<script setup lang="ts">
/**
 * /logout — end sessions of this browser (Zitadel login: `logout/page.tsx`). With a verified
 * `logout_token` (OIDC end_session) the hinted session is ended automatically and the user is
 * sent to the post-logout redirect.
 */
const t = useTranslations("logout");
useSeoMeta({ title: () => t("title") });

const { organization, logout_token } = useQueryParams("organization", "logout_token");

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("logout", () =>
	useAPI((api) => api.getLogout({ query: { organization, logout_token } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("title") }}</template>
		<template #description>{{ t("description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else-if="page" class="flex w-full flex-col gap-2">
			<LoginSessionsClearList
				:sessions="page.sessions"
				:logout-hint="page.logoutHint"
				:post-logout-redirect-uri="page.postLogoutRedirectUri"
				:organization="page.organization"
			/>
		</div>
	</LoginCard>
</template>
