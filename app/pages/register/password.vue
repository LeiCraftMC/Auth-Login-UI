<script setup lang="ts">
/**
 * /register/password — the password of a new account; the name and email come from /register
 * (Zitadel login: `register/password/page.tsx` + `SetRegisterPasswordForm`).
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("register");
useSeoMeta({ title: () => t("password.title") });

const { firstname, lastname, email, organization, requestId } = useQueryParams(
	"firstname",
	"lastname",
	"email",
	"organization",
	"requestId",
);

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("register-password", () =>
	useAPI((api) => api.getRegisterPassword({ query: { organization } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const org = computed(() => organization ?? page.value?.organization);
const missingData = computed(() => !firstname || !lastname || !email || !org.value);
const allowed = computed(
	() =>
		!!page.value?.loginSettings?.allowRegister &&
		!!page.value?.loginSettings?.allowLocalAuthentication,
);
const complexity = computed(() => page.value?.passwordComplexity ?? null);

const schema = computed(() =>
	z.object({
		password: z.string().min(1, t("password.required.password")),
		confirmPassword: z.string().min(1, t("password.required.confirmPassword")),
	}),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ password: "", confirmPassword: "" });

const canSubmit = computed(
	() =>
		!!complexity.value &&
		passwordMatchesComplexity(state.password, complexity.value) &&
		!!state.password &&
		state.password === state.confirmPassword,
);

async function onSubmit(event: FormSubmitEvent<Schema>) {
	if (!firstname || !lastname || !email || !org.value) return;
	const organizationId = org.value;
	await flow.run(() =>
		useAPI((api) =>
			api.postRegister({
				body: {
					email,
					firstName: firstname,
					lastName: lastname,
					organization: organizationId,
					requestId,
					password: event.data.password,
				},
			}),
		),
	);
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template v-if="missingData" #title>{{ t("missingdata.title") }}</template>
		<template v-else-if="allowed" #title>{{ t("password.title") }}</template>
		<template v-else #title>{{ t("disabled.title") }}</template>

		<template v-if="missingData" #description>{{ t("missingdata.description") }}</template>
		<template v-else-if="allowed" #description>{{ t("description") }}</template>
		<template v-else #description>{{ t("disabled.description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<UForm
			v-else-if="!missingData && allowed && page?.legal && complexity"
			:schema="schema"
			:state="state"
			class="w-full"
			@submit="onSubmit"
			@error="onError"
		>
			<div class="mb-4 grid grid-cols-1 gap-4 pt-4">
				<input
					type="text"
					name="username"
					autocomplete="username"
					:value="email"
					readonly
					tabindex="-1"
					aria-hidden="true"
					class="sr-only"
				/>
				<UFormField name="password" :label="t('password.labels.password')" required>
					<UInput
						v-model="state.password"
						type="password"
						autocomplete="new-password"
						autofocus
						class="w-full"
						data-testid="password-text-input"
					/>
				</UFormField>
				<UFormField name="confirmPassword" :label="t('password.labels.confirmPassword')" required>
					<UInput
						v-model="state.confirmPassword"
						type="password"
						autocomplete="new-password"
						class="w-full"
						data-testid="password-confirm-text-input"
					/>
				</UFormField>
			</div>

			<LoginPasswordComplexity
				:password-complexity-settings="complexity"
				:password="state.password"
				:equals="!!state.password && state.password === state.confirmPassword"
			/>

			<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />

			<div class="mt-8 flex w-full flex-row items-center justify-between">
				<LoginBackButton />
				<UButton
					type="submit"
					:loading="flow.loading.value"
					:disabled="!canSubmit"
					data-testid="submit-button"
				>
					{{ t("password.submit") }}
				</UButton>
			</div>
		</UForm>
	</LoginCard>
</template>
