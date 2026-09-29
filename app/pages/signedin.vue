<script setup lang="ts">
/**
 * /signedin — the end of a login without an application to return to, or of a device
 * authorization, which is approved here (Zitadel login: `signedin/page.tsx`).
 */
const t = useTranslations("signedin");
useSeoMeta({ title: () => t("title", { user: "" }) });

const query = useQueryParams("loginName", "requestId", "organization", "sessionId");
const { loginName, requestId, organization, sessionId } = query;
const isDeviceRequest = !!requestId?.startsWith("device_");

const deviceError = ref("");

// the device authorization is approved before the page is rendered (as the Zitadel login does)
if (isDeviceRequest && requestId) {
	const result = await useAPI((api) =>
		api.postDeviceAuthorize({ body: { requestId, sessionId, loginName, organization } }),
	);
	if (!result.success) deviceError.value = result.message;
}

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("signedin", () =>
	useAPI((api) => api.getSignedin({ query: { loginName, requestId, organization, sessionId } })),
);

const flow = useLoginFlow();
const user = computed(() => page.value?.session?.factors?.user);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template v-if="deviceError" #title>{{ t("error.title") }}</template>
		<template v-else #title>{{ t("title", { user: user?.displayName }) }}</template>
		<template v-if="deviceError" #description>{{ t("error.description") }}</template>
		<template v-else #description>{{ t("description") }}</template>
		<template #header>
			<LoginAlert v-if="deviceError">{{ deviceError }}</LoginAlert>
			<LoginUserAvatar
				v-else
				:login-name="loginName ?? user?.loginName"
				:display-name="user?.displayName ?? loginName"
				:show-dropdown="!isDeviceRequest"
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<template v-else-if="page && !deviceError">
			<LoginAlert v-if="isDeviceRequest" type="info">
				You can now close this window and return to the device where you started the authorization
				process to continue.
			</LoginAlert>

			<div v-if="page.redirectUri" class="mt-8 flex w-full flex-row items-center">
				<span class="grow" />
				<UButton type="button" @click="page.redirectUri && flow.navigate(page.redirectUri)">
					{{ t("continue") }}
				</UButton>
			</div>
			<LoginFlowState :error="flow.error.value" />
		</template>
	</LoginCard>
</template>
