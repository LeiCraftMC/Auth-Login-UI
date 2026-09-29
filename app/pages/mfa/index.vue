<script setup lang="ts">
/** /mfa — choose which second factor to verify (Zitadel login: `mfa/page.tsx`). */
const t = useTranslations("mfa");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("verify.title") });

const query = useQueryParams("loginName", "requestId", "organization", "sessionId");
const { loginName, requestId, organization, sessionId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("mfa", () =>
	useAPI((api) => api.getMfa({ query: { loginName, requestId, organization, sessionId } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("verify.title") }}</template>
		<template #description>{{ t("verify.description") }}</template>
		<template v-if="page?.session" #header>
			<LoginUserAvatar
				:login-name="loginName ?? page.session.factors?.user?.loginName"
				:display-name="page.session.factors?.user?.displayName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<template v-else-if="page">
			<LoginAlert v-if="!(loginName || sessionId)">{{ tError("unknownContext") }}</LoginAlert>

			<LoginChooseSecondFactor
				v-if="page.session"
				:login-name="loginName"
				:session-id="sessionId"
				:request-id="requestId"
				:organization="organization"
				:user-methods="page.authMethods"
			/>
			<LoginAlert v-else>{{ t("verify.noResults") }}</LoginAlert>

			<div class="mt-8 flex w-full flex-row items-center">
				<LoginBackButton />
				<span class="grow" />
			</div>
		</template>
	</LoginCard>
</template>
