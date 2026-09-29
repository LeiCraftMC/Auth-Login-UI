<script setup lang="ts">
/**
 * /mfa/set — set up a second factor after the primary one, forced (`force=true`) or skippable
 * (Zitadel login: `mfa/set/page.tsx`).
 */
const t = useTranslations("mfa");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("set.title") });

const query = useQueryParams(
	"loginName",
	"checkAfter",
	"force",
	"requestId",
	"organization",
	"sessionId",
);
const { loginName, checkAfter, force, requestId, organization, sessionId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("mfa-set", () =>
	useAPI((api) =>
		api.getMfaSet({ query: { loginName, force, requestId, organization, sessionId } }),
	),
);

const flow = useLoginFlow();

watch(
	page,
	(loaded) => {
		// forced MFA with only email codes available but an unverified email: verify it first
		if (loaded?.redirect) flow.navigate(loaded.redirect);
	},
	{ once: true },
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("set.title") }}</template>
		<template #description>{{ t("set.description") }}</template>
		<template v-if="page?.session" #header>
			<LoginUserAvatar
				:login-name="loginName ?? page.session.factors?.user?.loginName"
				:display-name="page.session.factors?.user?.displayName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else-if="page && !page.redirect" class="flex flex-col gap-4">
			<LoginAlert v-if="!(loginName || sessionId)">{{ tError("unknownContext") }}</LoginAlert>
			<LoginAlert v-if="!page.valid">{{ tError("sessionExpired") }}</LoginAlert>

			<LoginChooseSecondFactorToSetup
				v-if="page.valid && page.loginSettings && page.session?.factors?.user?.id"
				:user-id="page.session.factors.user.id"
				:login-name="loginName"
				:session-id="page.session.id"
				:request-id="requestId"
				:organization="organization"
				:login-settings="page.loginSettings"
				:user-methods="page.authMethods"
				:phone-verified="page.phoneVerified"
				:email-verified="page.emailVerified"
				:check-after="checkAfter === 'true'"
				:force="force === 'true'"
			/>

			<LoginFlowState :error="flow.error.value" />

			<div class="mt-8 flex w-full flex-row items-center">
				<LoginBackButton />
				<span class="grow" />
			</div>
		</div>
	</LoginCard>
</template>
