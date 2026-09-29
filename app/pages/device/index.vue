<script setup lang="ts">
/**
 * /device — enter the user code shown on a device (OAuth device authorization), continues with the
 * consent (Zitadel login: `device/page.tsx` + `DeviceCodeForm`). `?user_code=` prefills it.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("device");
useSeoMeta({ title: () => t("usercode.title") });

const { user_code: userCode, organization } = useQueryParams("user_code", "organization");

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("device", () => useAPI((api) => api.getDevice({ query: { organization } })));

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const schema = computed(() =>
	z.object({ userCode: z.string().trim().min(1, t("usercode.required.code")) }),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ userCode: userCode ?? "" });

async function onSubmit(event: FormSubmitEvent<Schema>) {
	const response = await flow.run(
		() => useAPI((api) => api.postDeviceCode({ body: { userCode: event.data.userCode } })),
		{ follow: false },
	);
	if (!response) return;

	await navigateTo(
		loginPath("/device/consent", {
			requestId: `device_${response.deviceAuthorizationRequestId}`,
			user_code: event.data.userCode,
		}),
	);
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("usercode.title") }}</template>
		<template #description>{{ t("usercode.description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<UForm
			v-else-if="page"
			:schema="schema"
			:state="state"
			class="w-full"
			@submit="onSubmit"
			@error="onError"
		>
			<UFormField name="userCode" :label="t('usercode.labels.code')" class="mt-4">
				<UInput
					v-model="state.userCode"
					autocomplete="one-time-code"
					autofocus
					class="w-full"
					data-testid="code-text-input"
				/>
			</UFormField>

			<LoginFlowState :error="flow.error.value" />

			<div class="mt-8 flex w-full flex-row items-center">
				<LoginBackButton />
				<span class="grow" />
				<UButton
					type="submit"
					:loading="flow.loading.value"
					:disabled="!state.userCode.trim()"
					data-testid="submit-button"
				>
					{{ t("usercode.submit") }}
				</UButton>
			</div>
		</UForm>
	</LoginCard>
</template>
