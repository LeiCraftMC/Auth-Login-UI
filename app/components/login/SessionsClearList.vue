<script setup lang="ts">
/**
 * The accounts on the logout page (Zitadel login: `SessionsClearList`). With a `logoutHint` the
 * matching session is ended right away and the user is sent on to the post-logout redirect.
 */
import type { LoginSession } from "~/utils/loginTypes";

const props = defineProps<{
	sessions: LoginSession[];
	postLogoutRedirectUri?: string;
	logoutHint?: string;
	organization?: string;
}>();

const t = useTranslations("logout");
const tError = useTranslations("error");
const flow = useLoginFlow();

const list = ref(sortSessions(props.sessions));

async function onRemoved(sessionId: string) {
	list.value = list.value.filter((s) => s.id !== sessionId);
	if (props.postLogoutRedirectUri) {
		await flow.navigate(props.postLogoutRedirectUri);
	}
}

onMounted(async () => {
	if (!props.logoutHint) return;

	const hinted = props.sessions.find((s) => s.factors?.user?.loginName === props.logoutHint);
	if (!hinted) {
		console.warn(`No session found for login hint: ${props.logoutHint}`);
		return;
	}

	const result = await useAPI((api) =>
		api.deleteSessionBySessionId({ path: { sessionId: hinted.id } }),
	);
	// Don't tell the RP the logout completed when the session was kept: show the error instead.
	if (!result.success) {
		flow.error.value = result.message || tError("couldNotClearSession");
		return;
	}

	if (props.postLogoutRedirectUri) {
		await flow.navigate(props.postLogoutRedirectUri);
		return;
	}
	await navigateTo(loginPath("/logout/done", { organization: props.organization }));
});
</script>

<template>
	<div class="flex flex-col gap-2">
		<LoginSessionClearItem
			v-for="session in list"
			:key="session.id"
			:session="session"
			@removed="onRemoved(session.id)"
		/>
		<LoginAlert v-if="flow.error.value">{{ flow.error.value }}</LoginAlert>
		<LoginAlert v-if="list.length === 0" type="info">{{ t("noResults") }}</LoginAlert>
	</div>
</template>
