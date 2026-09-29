<script setup lang="ts">
/** /u2f — a security key as second factor (Zitadel login: `u2f/page.tsx`). */
const t = useTranslations("u2f");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("verify.title") });

const query = useQueryParams("loginName", "requestId", "sessionId", "organization");
const { loginName, requestId, sessionId, organization } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("u2f", () =>
	useAPI((api) => api.getU2F({ query: { loginName, requestId, sessionId, organization } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("verify.title") }}</template>
		<template #description>{{ t("verify.description") }}</template>
		<template #header>
			<LoginUserAvatar
				v-if="page?.session"
				:login-name="loginName ?? page.session.factors?.user?.loginName"
				:display-name="page.session.factors?.user?.displayName"
				show-dropdown
				:search-params="query"
			/>
			<LoginAlert v-if="!(loginName || sessionId)">{{ tError("unknownContext") }}</LoginAlert>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>
		<!-- second factor: user verification is discouraged -->
		<PasskeyLogin
			v-else-if="page && (loginName || sessionId)"
			:login-name="loginName"
			:session-id="sessionId"
			:request-id="requestId"
			:alt-password="false"
			:organization="organization"
			:login="false"
		/>
	</LoginCard>
</template>
