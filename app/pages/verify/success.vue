<script setup lang="ts">
/**
 * /verify/success — the email is verified; continues the login when there is a request to finish
 * (Zitadel login: `verify/success/page.tsx` + `VerifySuccessContinue`).
 */
const t = useTranslations("verify");
useSeoMeta({ title: () => t("successTitle") });

const query = useQueryParams("loginName", "organization", "userId", "requestId", "sessionId");
const { loginName, organization, userId, requestId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("verify-success", () =>
	useAPI((api) => api.getVerifySuccess({ query: { loginName, organization, userId, requestId } })),
);

const flow = useLoginFlow();
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("successTitle") }}</template>
		<template #description>{{ t("successDescription") }}</template>
		<template v-if="page?.avatar" #header>
			<LoginUserAvatar
				:login-name="page.avatar.loginName"
				:display-name="page.avatar.displayName"
				:show-dropdown="page.avatar.showDropdown"
				:search-params="page.avatar.showDropdown ? query : undefined"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else-if="page?.continueUrl" class="mt-8 flex w-full flex-row items-center justify-end">
			<UButton
				type="button"
				data-testid="continue-button"
				@click="page.continueUrl && flow.navigate(page.continueUrl)"
			>
				{{ t("successContinue") }}
			</UButton>
		</div>
		<LoginFlowState :error="flow.error.value" />
	</LoginCard>
</template>
