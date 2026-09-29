<script setup lang="ts">
/**
 * /authenticator/set — the first authenticator of a user without one (invite / registration):
 * password, passkey or a linked IdP (Zitadel login: `authenticator/set/page.tsx`). Without a
 * recent user verification in this browser the user is sent to /verify first.
 */
const t = useTranslations("authenticator");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("title") });

const query = useQueryParams("loginName", "requestId", "organization", "sessionId");
const { loginName, requestId, organization, sessionId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("authenticator-set", () =>
	useAPI((api) =>
		api.getAuthenticatorSet({ query: { loginName, requestId, organization, sessionId } }),
	),
);

const flow = useLoginFlow();
const user = computed(() => page.value?.session?.factors?.user);

watch(
	page,
	(loaded) => {
		if (loaded?.redirect) flow.navigate(loaded.redirect);
	},
	{ once: true },
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("title") }}</template>
		<template #description>{{ t("description") }}</template>
		<template v-if="user" #header>
			<LoginUserAvatar
				:login-name="user.loginName"
				:display-name="user.displayName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<!-- context was given but the session could not be resolved (cookie missing or expired) -->
		<LoginAlert v-else-if="page?.error">{{ tError(page.error) }}</LoginAlert>

		<template v-else-if="page && !page.redirect">
			<LoginChooseAuthenticatorToSetup
				v-if="page.loginSettings"
				:auth-methods="page.authMethods"
				:login-settings="page.loginSettings"
				:params="page.setupParams"
			/>

			<template v-if="page.loginSettings?.allowExternalIdp && page.identityProviders.length">
				<div class="flex flex-col py-3">
					<p class="text-center text-sm text-muted">{{ t("linkWithIDP") }}</p>
				</div>

				<!-- the session id tells the IdP callback to link the IdP to this user -->
				<LoginIdpButtons
					:show-label="false"
					:identity-providers="page.identityProviders"
					:request-id="requestId"
					:organization="user?.organizationId"
					:session-id="page.session?.id"
					:login-hint="user?.loginName"
				/>
			</template>

			<LoginFlowState :error="flow.error.value" />

			<div class="mt-8 flex w-full flex-row items-center">
				<LoginBackButton />
				<span class="grow" />
			</div>
		</template>
	</LoginCard>
</template>
