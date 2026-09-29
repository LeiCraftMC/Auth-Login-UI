<script setup lang="ts">
/**
 * /otp/[method]/set — add a one-time-code second factor (Zitadel login: `otp/[method]/set/page.tsx`
 * + `TotpRegister`). Loading the page registers it: `time-based` shows the QR code to confirm with
 * a first code, `sms` / `email` are added right away.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import { renderSVG } from "uqr";
import * as z from "zod";

type Method = "time-based" | "sms" | "email";

const t = useTranslations("otp");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("set.title") });

const route = useRoute();
const method = String(route.params.method) as Method;
if (!["time-based", "sms", "email"].includes(method)) {
	throw createError({ statusCode: 404, statusMessage: "Page not found" });
}

const query = useQueryParams("loginName", "organization", "sessionId", "requestId", "checkAfter");
const { loginName, organization, sessionId, requestId, checkAfter } = query;

// the registration happens when the page is loaded, like the server-rendered Zitadel login page
const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage(`otp-${method}-set`, () =>
	useAPI((api) =>
		api.postOtpByMethodSet({
			path: { method },
			body: {
				loginName,
				organization,
				sessionId,
				requestId,
				checkAfter: checkAfter === "true",
			},
		}),
	),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const qrCode = computed(() =>
	page.value?.totp ? renderSVG(page.value.totp.uri, { border: 1 }) : "",
);

const schema = computed(() => z.object({ code: z.string().trim().min(1, t("set.required.code")) }));
type Schema = z.output<typeof schema.value>;

const state = reactive({ code: "" });

async function continueWithCode(event: FormSubmitEvent<Schema>) {
	const verified = await flow.run(
		() =>
			useAPI((api) =>
				api.postOtpTotpVerify({ body: { code: event.data.code, loginName, organization } }),
			),
		{ follow: false },
	);
	if (verified === null) return;

	// with checkAfter the new factor is checked right away, otherwise the login continues
	if (checkAfter === "true") {
		await navigateTo(loginPath("/otp/time-based", { loginName, requestId, organization }));
		return;
	}

	if ((requestId && sessionId) || loginName) {
		await flow.run(() =>
			useAPI((api) =>
				api.postFlowComplete({
					body:
						requestId && sessionId ? { sessionId, requestId, organization } : { loginName, organization },
				}),
			),
		);
	}
}

watch(
	page,
	(loaded) => {
		// email / SMS with checkAfter: the page is left right away
		if (loaded?.redirect) flow.navigate(loaded.redirect);
	},
	{ once: true },
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("set.title") }}</template>
		<template #description>
			<template v-if="page?.totp">{{ t("set.totpRegisterDescription") }}</template>
			<template v-else-if="method === 'email'">Code via email was successfully added.</template>
			<template v-else-if="method === 'sms'">Code via SMS was successfully added.</template>
		</template>
		<template v-if="page" #header>
			<!-- context was given but the session could not be resolved (cookie missing or expired) -->
			<div v-if="!page.session" class="w-full py-4">
				<LoginAlert>{{ tError(loginName || sessionId ? "sessionExpired" : "unknownContext") }}</LoginAlert>
			</div>
			<div v-if="page.error" class="w-full py-4">
				<LoginAlert>{{ page.error }}</LoginAlert>
			</div>
			<LoginUserAvatar
				v-if="page.session"
				:login-name="loginName ?? page.session.factors?.user?.loginName"
				:display-name="page.session.factors?.user?.displayName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else-if="page?.totp" class="flex flex-col items-center">
			<LoginAutoSubmitForm
				v-if="flow.samlData.value"
				:url="flow.samlData.value.url"
				:fields="flow.samlData.value.fields"
			/>
			<!-- eslint-disable-next-line vue/no-v-html -- generated SVG of the TOTP URI -->
			<div class="my-4 h-40 w-40 rounded-md bg-white p-2" data-testid="totp-qr-code" v-html="qrCode" />
			<div class="my-2 mb-4 flex w-full items-center rounded-lg border border-slate-800 px-4 py-2 pr-2 text-sm">
				<ULink :to="page.totp.uri" target="_blank" class="flex-1 overflow-x-auto whitespace-nowrap">
					{{ page.totp.uri }}
				</ULink>
				<OtpCopyToClipboard :value="page.totp.uri" />
			</div>

			<UForm
				:schema="schema"
				:state="state"
				class="w-full"
				@submit="continueWithCode"
				@error="onError"
			>
				<UFormField name="code" :label="t('set.labels.code')">
					<UInput
						v-model="state.code"
						autocomplete="one-time-code"
						autofocus
						class="w-full"
						data-testid="code-text-input"
					/>
				</UFormField>

				<div v-if="flow.error.value" class="py-4">
					<LoginAlert>{{ flow.error.value }}</LoginAlert>
				</div>

				<div class="mt-8 flex w-full flex-row items-center">
					<span class="grow" />
					<UButton
						type="submit"
						:loading="flow.loading.value"
						:disabled="!state.code.trim()"
						data-testid="submit-button"
					>
						{{ t("set.submit") }}
					</UButton>
				</div>
			</UForm>
		</div>

		<div v-else-if="page" class="mt-8 flex w-full flex-row items-center">
			<LoginBackButton />
			<span class="grow" />
			<UButton type="button" @click="flow.navigate(page.continueUrl)">{{ t("set.submit") }}</UButton>
		</div>
	</LoginCard>
</template>
