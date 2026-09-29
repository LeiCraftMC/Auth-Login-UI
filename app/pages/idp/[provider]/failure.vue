<script setup lang="ts">
/**
 * /idp/[provider]/failure — the IdP login failed; offers the user's other methods (Zitadel login:
 * `idp/[provider]/failure/page.tsx`).
 */
const t = useTranslations("idp");
useSeoMeta({ title: () => t("loginError.title") });

const { organization, userId } = useQueryParams("organization", "userId");

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp-failure", () =>
	useAPI((api) => api.getIdpFailure({ query: { organization, userId } })),
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("loginError.title") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<template v-else-if="page">
			<LoginAlert>{{ t("loginError.description") }}</LoginAlert>

			<div v-if="userId && page.authMethods.length" class="mt-4 flex flex-col gap-4">
				<LoginUserAvatar
					v-if="page.user"
					:login-name="page.user.loginName"
					:display-name="page.user.displayName"
				/>
				<LoginChooseAuthenticatorToLogin
					:auth-methods="page.authMethods"
					:login-settings="page.loginSettings"
					:params="page.params"
				/>
			</div>
		</template>
	</LoginCard>
</template>
