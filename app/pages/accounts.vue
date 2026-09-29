<script setup lang="ts">
/** /accounts — the accounts of this browser to continue with (Zitadel login: `accounts/page.tsx`). */
const t = useTranslations("accounts");
useSeoMeta({ title: () => t("title") });

const { requestId, organization, orgDomain } = useQueryParams(
	"requestId",
	"organization",
	"orgDomain",
);

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("accounts", () =>
	useAPI((api) => api.getAccounts({ query: { requestId, organization, orgDomain } })),
);

const addAnotherLink = loginPath("/loginname", { requestId, organization, orgDomain });
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("title") }}</template>
		<template #description>{{ t("description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else-if="page" class="flex w-full flex-col gap-2">
			<LoginSessionsList :sessions="page.sessions" :request-id="requestId" />
			<NuxtLink
				:to="addAnotherLink"
				class="flex flex-row items-center rounded-md px-4 py-3 transition-all hover:bg-accented/50"
				data-testid="add-another-account"
			>
				<div class="mr-4 flex h-8 w-8 flex-row items-center justify-center rounded-full bg-elevated">
					<UIcon name="i-lucide-user-plus" class="h-5 w-5" />
				</div>
				<span class="text-sm">{{ t("addAnother") }}</span>
			</NuxtLink>
		</div>
	</LoginCard>
</template>
