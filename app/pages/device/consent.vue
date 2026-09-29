<script setup lang="ts">
/**
 * /device/consent — what the device's application asks for; "Allow" continues with the login,
 * "Deny" ends the request (Zitadel login: `device/consent/page.tsx` + `ConsentScreen`).
 */
const t = useTranslations("device");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("usercode.title") });

const {
	user_code: userCode,
	requestId,
	organization,
} = useQueryParams("user_code", "requestId", "organization");

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("device-consent", () =>
	useAPI((api) => api.getDeviceConsent({ query: { user_code: userCode, requestId, organization } })),
);

const flow = useLoginFlow();

const request = computed(() => page.value?.deviceAuthorizationRequest ?? null);
const appName = computed(() => request.value?.appName ?? "");
const scopes = computed(() => request.value?.scope.filter((s) => !!s) ?? []);

/** Description of a scope; unknown scopes get an empty line (as in the Zitadel login). */
function scopeDescription(scope: string) {
	const text = t(`scope.${scope}`);
	return text === `device.scope.${scope}` ? "" : text;
}

async function deny() {
	const id = request.value?.id;
	if (!id) return;
	const result = await flow.run(
		() => useAPI((api) => api.postDeviceDeny({ body: { deviceAuthorizationId: id } })),
		{ follow: false },
	);
	if (result !== null) await navigateTo("/device");
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template v-if="request" #title>{{ t("request.title", { appName }) }}</template>
		<template v-if="request" #description>{{ t("request.description", { appName }) }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>
		<LoginAlert v-else-if="page?.error">{{ tError(page.error) }}</LoginAlert>

		<div v-else-if="request" class="flex w-full flex-col items-center gap-4 pt-4">
			<ul class="w-full space-y-2">
				<li
					v-if="scopes.length === 0"
					class="flex w-full flex-row items-center rounded-md border border-default bg-elevated/50 px-4 py-2 text-sm"
				>
					{{ t("scope.openid") }}
				</li>
				<li
					v-for="scope in scopes"
					:key="scope"
					class="flex w-full flex-row items-center rounded-md border border-default bg-elevated/50 px-4 py-2 text-sm"
				>
					{{ scopeDescription(scope) }}
				</li>
			</ul>

			<p class="text-left text-xs text-muted">{{ t("request.disclaimer", { appName }) }}</p>

			<LoginFlowState :error="flow.error.value" />

			<div class="mt-4 flex w-full flex-row items-center">
				<UButton
					type="button"
					color="neutral"
					variant="subtle"
					:loading="flow.loading.value"
					data-testid="deny-button"
					@click="deny"
				>
					{{ t("request.deny") }}
				</UButton>
				<span class="grow" />
				<UButton :to="page?.nextUrl" data-testid="submit-button">{{ t("request.submit") }}</UButton>
			</div>
		</div>
	</LoginCard>
</template>
