<script setup lang="ts">
/**
 * /otp/[method] — second factor with a one-time code: `time-based` (authenticator app), `sms` or
 * `email` (Zitadel login: `otp/[method]/page.tsx` + `LoginOTP`). SMS / email codes are requested
 * on load unless the email link already carries the code.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

type Method = "time-based" | "sms" | "email";

const t = useTranslations("otp");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("verify.title") });

const route = useRoute();
const method = String(route.params.method) as Method;
if (!["time-based", "sms", "email"].includes(method)) {
	throw createError({ statusCode: 404, statusMessage: "Page not found" });
}

const query = useQueryParams("loginName", "requestId", "sessionId", "organization", "code");
const { loginName, requestId, sessionId, organization, code } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage(`otp-${method}`, () =>
	useAPI((api) =>
		api.getOtpByMethod({
			path: { method },
			query: { loginName, requestId, sessionId, organization },
		}),
	),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const session = computed(() => page.value?.session ?? null);
// email links carry no organization: use the session's
const effectiveOrganization = computed(
	() => organization ?? session.value?.factors?.user?.organizationId,
);
const effectiveLoginName = computed(() => loginName ?? session.value?.factors?.user?.loginName);

const schema = computed(() =>
	z.object({ code: z.string().trim().min(1, t("verify.required.code")) }),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ code: code ?? "" });

/** Sends the SMS / email code (the server builds the email link to this page). */
async function requestChallenge() {
	await flow.run(
		() =>
			useAPI((api) =>
				api.postSession({
					body: {
						loginName: effectiveLoginName.value,
						sessionId,
						organization: effectiveOrganization.value,
						requestId,
						challenges: method === "email" ? { otpEmail: true } : { otpSms: true },
					},
				}),
			),
		{ follow: false },
	);
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
	const checks =
		method === "sms"
			? { otpSms: { code: event.data.code } }
			: method === "email"
				? { otpEmail: { code: event.data.code } }
				: { totp: { code: event.data.code } };

	const response = await flow.run(
		() =>
			useAPI((api) =>
				api.postSession({
					body: {
						loginName: effectiveLoginName.value,
						sessionId,
						organization: effectiveOrganization.value,
						checks,
						requestId,
					},
				}),
			),
		{ follow: false },
	);
	const user = response?.session.factors?.user;
	if (!response || !user) return;

	flow.loading.value = true;
	// eventual consistency of the verified code in the /login endpoint (as the Zitadel login does)
	await new Promise((resolve) => setTimeout(resolve, 2000));

	await flow.run(() =>
		useAPI((api) =>
			api.postFlowComplete({
				body: requestId
					? { sessionId: response.session.id, requestId, organization: user.organizationId }
					: { loginName: user.loginName, organization: user.organizationId },
			}),
		),
	);
}

watch(
	page,
	(loaded) => {
		if (loaded?.session && (method === "email" || method === "sms") && !code) {
			requestChallenge();
		}
	},
	{ once: true },
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("verify.title") }}</template>
		<template #description>
			<template v-if="method === 'time-based'">{{ t("verify.totpDescription") }}</template>
			<template v-else-if="method === 'sms'">{{ t("verify.smsDescription") }}</template>
			<template v-else>{{ t("verify.emailDescription") }}</template>
		</template>
		<template v-if="page" #header>
			<!-- context was given but the session could not be resolved (cookie missing or expired) -->
			<div v-if="!session" class="w-full py-4">
				<LoginAlert>{{ tError(loginName || sessionId ? "sessionExpired" : "unknownContext") }}</LoginAlert>
			</div>
			<LoginUserAvatar
				v-else
				:login-name="loginName ?? session.factors?.user?.loginName"
				:display-name="session.factors?.user?.displayName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<UForm
			v-else-if="session"
			:schema="schema"
			:state="state"
			class="w-full"
			@submit="onSubmit"
			@error="onError"
		>
			<LoginAlert v-if="method === 'email' || method === 'sms'" type="info">
				<div class="flex flex-row">
					<span class="mr-auto flex-1 text-left">{{ t("verify.noCodeReceived") }}</span>
					<UButton
						type="button"
						variant="link"
						class="ml-4 p-0"
						:aria-label="t('verify.resendCode')"
						:disabled="flow.loading.value"
						data-testid="resend-button"
						@click="requestChallenge"
					>
						{{ t("verify.resendCode") }}
					</UButton>
				</div>
			</LoginAlert>

			<UFormField name="code" :label="t('verify.labels.code')" class="mt-4">
				<UInput
					v-model="state.code"
					autocomplete="one-time-code"
					autofocus
					class="w-full"
					data-testid="code-text-input"
				/>
			</UFormField>

			<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />

			<div class="mt-8 flex w-full flex-row items-center">
				<LoginBackButton />
				<span class="grow" />
				<UButton
					type="submit"
					:loading="flow.loading.value"
					:disabled="!state.code.trim()"
					data-testid="submit-button"
				>
					{{ t("verify.submit") }}
				</UButton>
			</div>
		</UForm>
	</LoginCard>
</template>
