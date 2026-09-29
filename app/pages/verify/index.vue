<script setup lang="ts">
/**
 * /verify — email / invite verification with the code from the email (Zitadel login:
 * `verify/page.tsx` + `VerifyForm`). A code from the email link is submitted automatically when
 * AUTO_SUBMIT_CODE is set.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("verify");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("verify.title") });

const query = useQueryParams(
	"userId",
	"loginName",
	"organization",
	"requestId",
	"code",
	"invite",
	"codeSent",
	"sessionId",
);
const { userId, loginName, organization, requestId, code, invite } = query;
const isInvite = invite === "true";

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("verify", () =>
	useAPI((api) => api.getVerify({ query: { userId, loginName, organization, requestId } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();
const codeSent = ref(query.codeSent === "true");

const schema = computed(() =>
	z.object({ code: z.string().trim().min(1, t("verify.required.code")) }),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ code: code ?? "" });

async function submitCode(value: string) {
	const id = page.value?.userId;
	if (!id) return;
	await flow.run(() =>
		useAPI((api) =>
			api.postVerify({
				body: { code: value, userId: id, isInvite, loginName, organization, requestId },
			}),
		),
	);
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
	await submitCode(event.data.code);
}

async function resendCode() {
	const id = page.value?.userId;
	if (!id) return;
	const result = await flow.run(
		() => useAPI((api) => api.postVerifyResend({ body: { userId: id, isInvite, requestId } })),
		{ follow: false },
	);
	if (result === null) return;

	// signal success in the URL like the Zitadel login, so a reload keeps the "code sent" alert
	codeSent.value = true;
	const url = new URL(window.location.href);
	url.searchParams.set("codeSent", "true");
	window.history.replaceState(window.history.state, "", url);
}

watch(
	page,
	(loaded) => {
		if (loaded?.autoSubmit && loaded.userId && code) {
			submitCode(code);
		}
	},
	{ once: true },
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("verify.title") }}</template>
		<template #description>{{ t("verify.description") }}</template>
		<template v-if="page?.avatar" #header>
			<LoginUserAvatar
				:login-name="page.avatar.loginName"
				:display-name="page.avatar.displayName"
				:show-dropdown="page.avatar.showDropdown"
				:search-params="page.avatar.showDropdown ? query : undefined"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else-if="page && !page.userId" class="py-4">
			<LoginAlert>{{ tError("unknownContext") }}</LoginAlert>
		</div>

		<template v-else-if="page">
			<div v-if="codeSent" class="w-full py-4">
				<LoginAlert type="info">{{ t("verify.codeSent") }}</LoginAlert>
			</div>

			<UForm :schema="schema" :state="state" class="w-full" @submit="onSubmit" @error="onError">
				<LoginAlert type="info">
					<div class="flex flex-row">
						<span class="mr-auto flex-1 text-left">{{ t("verify.noCodeReceived") }}</span>
						<UButton
							type="button"
							variant="link"
							class="ml-4 p-0"
							aria-label="Resend Code"
							:disabled="flow.loading.value"
							data-testid="resend-button"
							@click="resendCode"
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
		</template>
	</LoginCard>
</template>
