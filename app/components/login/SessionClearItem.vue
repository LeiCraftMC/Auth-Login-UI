<script setup lang="ts">
/** An account on the logout page: a click ends the session (Zitadel login: `SessionClearItem`). */
import type { LoginSession } from "~/utils/loginTypes";

const props = defineProps<{ session: LoginSession }>();
const emit = defineEmits<{ removed: [] }>();

const t = useTranslations("logout");
const tError = useTranslations("error");
const locale = useLoginLocale();

const error = ref("");
const loading = ref(false);
const state = computed(() => sessionPrimaryFactorState(props.session));
const user = computed(() => props.session.factors?.user);

async function clear() {
	loading.value = true;
	error.value = "";
	const result = await useAPI((api) =>
		api.deleteSessionBySessionId({ path: { sessionId: props.session.id } }),
	);
	loading.value = false;
	if (!result.success) {
		error.value = result.message || tError("couldNotClearSession");
		return;
	}
	emit("removed");
}
</script>

<template>
	<button
		type="button"
		class="group flex w-full flex-row items-center rounded-md border border-default bg-elevated/50 px-4 py-2 text-left transition-all hover:bg-accented/50 hover:shadow-lg disabled:opacity-60"
		:disabled="loading"
		@click="clear"
	>
		<div class="pr-4">
			<LoginAvatar size="small" :login-name="user?.loginName ?? ''" :name="user?.displayName ?? ''" />
		</div>

		<div class="flex flex-col items-start overflow-hidden">
			<span>{{ user?.displayName }}</span>
			<span class="truncate text-xs opacity-80">{{ user?.loginName }}</span>
			<span v-if="state.valid && state.verifiedAt" class="truncate text-xs opacity-80">
				{{ t("verifiedAt", { time: formatRelativeTime(state.verifiedAt, locale) }) }}
			</span>
			<span v-else-if="state.verifiedAt" class="truncate text-xs opacity-80">
				expired
				{{ session.expirationDate ? formatRelativeTime(session.expirationDate, locale) : "" }}
			</span>
		</div>

		<span class="grow" />
		<div class="relative flex flex-row items-center">
			<UBadge color="error" variant="subtle" size="sm" class="mr-6 hidden group-hover:block">
				{{ t("clear") }}
			</UBadge>
			<div
				class="absolute right-0 mx-2 h-2 w-2 rounded-full transition-all"
				:class="state.valid ? 'bg-green-500' : 'bg-red-500'"
			/>
		</div>
	</button>
	<LoginAlert v-if="error">{{ error }}</LoginAlert>
</template>
