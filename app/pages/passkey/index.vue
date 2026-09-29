<script setup lang="ts">
/** /passkey — login with a passkey (Zitadel login: `passkey/page.tsx`). */
const t = useTranslations("passkey");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("verify.title") });

const query = useQueryParams("loginName", "altPassword", "requestId", "organization", "sessionId");
const { loginName, altPassword, requestId, organization, sessionId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("passkey", () =>
	useAPI((api) => api.getPasskey({ query: { loginName, requestId, organization, sessionId } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("verify.title") }}</template>
		<template #description>{{ t("verify.description") }}</template>
		<template v-if="page?.session || loginName" #header>
			<LoginUserAvatar
				:login-name="loginName ?? page?.session?.factors?.user?.loginName"
				:display-name="page?.session?.factors?.user?.displayName ?? loginName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>
		<LoginAlert v-else-if="!(loginName || sessionId)">{{ tError("unknownContext") }}</LoginAlert>
		<PasskeyLogin
			v-else-if="page"
			:login-name="loginName"
			:session-id="sessionId"
			:request-id="requestId"
			:alt-password="altPassword === 'true'"
			:organization="organization"
		/>
	</LoginCard>
</template>
