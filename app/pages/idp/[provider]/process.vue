<script setup lang="ts">
/**
 * /idp/[provider]/process — the success callback of an IdP intent: consumes the single-use intent
 * once and signs in, links, creates or asks to register the user (Zitadel login:
 * `idp/[provider]/process/page.tsx` + `IdpProcessHandler`).
 */
const t = useTranslations("idp");
useSeoMeta({ title: () => t("title") });

const route = useRoute();
const provider = String(route.params.provider);

const query = useQueryParams(
	"id",
	"token",
	"requestId",
	"organization",
	"postErrorRedirectUrl",
	"linkToSessionId",
	"linkFingerprint",
);
const { id, token, requestId, organization } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp-process", () =>
	useAPI((api) => api.getSettingsBranding({ query: { organization, fallbackToDefault: "true" } })),
);

const flow = useLoginFlow();
const processing = ref(!!(id && token));

// The intent token is single-use: run exactly once per page load (the page remounts per URL).
let executed = false;

onMounted(async () => {
	if (executed || !id || !token) return;
	executed = true;

	const result = await flow.run(
		() =>
			useAPI((api) =>
				api.postIdpProcess({
					body: {
						provider,
						id,
						token,
						requestId,
						organization,
						postErrorRedirectUrl: query.postErrorRedirectUrl,
						linkToSessionId: query.linkToSessionId,
						linkFingerprint: query.linkFingerprint,
					},
				}),
			),
		{ follow: false },
	);

	if (!result) {
		processing.value = false;
		return;
	}
	if (await flow.follow(result)) {
		// a redirect keeps the spinner until the page is left; a SAML post submits itself
		if (!result.redirect) processing.value = false;
		return;
	}
	flow.error.value ||= t("processing.noRedirect");
	processing.value = false;
});
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>
		<LoginAlert v-else-if="!id || !token">{{ t("errors.missingParameters") }}</LoginAlert>

		<div v-else class="flex items-center justify-center">
			<LoginAutoSubmitForm
				v-if="flow.samlData.value"
				:url="flow.samlData.value.url"
				:fields="flow.samlData.value.fields"
			/>
			<div v-if="processing" class="flex flex-col items-center gap-4">
				<UIcon name="i-lucide-loader-circle" class="h-8 w-8 animate-spin" />
				<p class="text-sm text-muted">{{ t("processing.message") }}</p>
			</div>
			<div v-if="flow.error.value" class="max-w-md py-4">
				<LoginAlert>{{ flow.error.value }}</LoginAlert>
			</div>
		</div>
	</LoginCard>
</template>
