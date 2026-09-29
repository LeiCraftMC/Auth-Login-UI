<script setup lang="ts">
/** The user the page is for, with a switch to the account list (Zitadel login: `UserAvatar`). */
const props = defineProps<{
	loginName?: string;
	displayName?: string;
	showDropdown?: boolean;
	/** Parameters kept when switching the account (`sessionId`, `organization`, `requestId`, `loginName`). */
	searchParams?: Record<string, string | undefined>;
}>();

const accountsLink = computed(() =>
	loginPath("/accounts", {
		sessionId: props.searchParams?.sessionId,
		organization: props.searchParams?.organization,
		requestId: props.searchParams?.requestId,
		loginName: props.searchParams?.loginName,
	}),
);
</script>

<template>
	<div class="flex h-full w-full flex-row items-center rounded-full border border-accented p-px text-left">
		<LoginAvatar size="small" :name="displayName ?? loginName ?? ''" :login-name="loginName ?? ''" />
		<span class="ml-4 max-w-[250px] truncate pr-4 text-sm">{{ loginName }}</span>
		<span class="grow" />
		<ULink
			v-if="showDropdown"
			:to="accountsLink"
			class="mr-1 ml-4 flex items-center justify-center rounded-full p-1 transition-all hover:bg-accented/50"
			aria-label="accounts"
		>
			<UIcon name="i-lucide-chevron-down" class="h-4 w-4" />
		</ULink>
	</div>
</template>
