<script setup lang="ts">
import type { LoginSession } from "~/utils/loginTypes";

const props = defineProps<{ sessions: LoginSession[]; requestId?: string }>();

const t = useTranslations("accounts");
const list = ref(sortSessions(props.sessions));

function remove(sessionId: string) {
	list.value = list.value.filter((s) => s.id !== sessionId);
}
</script>

<template>
	<div v-if="sessions.length" class="flex flex-col gap-2">
		<LoginSessionItem
			v-for="session in list"
			:key="session.id"
			:session="session"
			:request-id="requestId"
			@removed="remove(session.id)"
		/>
	</div>
	<LoginAlert v-else>{{ t("noResults") }}</LoginAlert>
</template>
