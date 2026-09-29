<script setup lang="ts">
/**
 * /idp/[provider]/complete-registration — the IdP did not provide all data for a new account:
 * complete it and register with the IdP linked (Zitadel login: `complete-registration/page.tsx`
 * + `RegisterFormIDPIncomplete`).
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("register");
const tIdp = useTranslations("idp");
useSeoMeta({ title: () => tIdp("completeRegister.title") });

const {
	id,
	token,
	requestId,
	organization,
	idpId,
	idpUserId,
	idpUserName,
	givenName,
	familyName,
	email,
} = useQueryParams(
	"id",
	"token",
	"requestId",
	"organization",
	"idpId",
	"idpUserId",
	"idpUserName",
	"givenName",
	"familyName",
	"email",
);
const complete = !!(id && token && idpId && organization && idpUserId);

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp-complete-registration", () =>
	useAPI((api) => api.getSettingsBranding({ query: { organization } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const schema = computed(() =>
	z.object({
		username: idpUserName ? z.string().optional() : z.string().trim().min(1, "Username is required"),
		firstname: z.string().trim().min(1, t("required.firstname")),
		lastname: z.string().trim().min(1, t("required.lastname")),
		email: z.string().trim().min(1, t("required.email")),
	}),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({
	username: "",
	firstname: givenName ?? "",
	lastname: familyName ?? "",
	email: email ?? "",
});

const canSubmit = computed(
	() =>
		(!!idpUserName || !!state.username.trim()) &&
		!!state.firstname.trim() &&
		!!state.lastname.trim() &&
		!!state.email.trim(),
);

async function onSubmit(event: FormSubmitEvent<Schema>) {
	if (!id || !token || !idpId || !organization || !idpUserId) return;
	await flow.run(() =>
		useAPI((api) =>
			api.postRegisterIdp({
				body: {
					idpId,
					idpUserName: idpUserName || event.data.username || "",
					idpUserId,
					email: event.data.email,
					firstName: event.data.firstname,
					lastName: event.data.lastname,
					organization,
					requestId,
					idpIntent: { idpIntentId: id, idpIntentToken: token },
				},
			}),
		),
	);
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ tIdp("completeRegister.title") }}</template>
		<template #description>{{ tIdp("completeRegister.description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>
		<LoginAlert v-else-if="!complete">{{ tIdp("errors.missingParameters") }}</LoginAlert>

		<UForm
			v-else-if="page"
			:schema="schema"
			:state="state"
			class="w-full"
			@submit="onSubmit"
			@error="onError"
		>
			<div class="mb-4 grid grid-cols-1 gap-4">
				<UFormField v-if="!idpUserName" name="username" label="Username" required>
					<UInput
						v-model="state.username"
						autocomplete="username"
						autofocus
						class="w-full"
						data-testid="username-text-input"
					/>
				</UFormField>
				<div class="grid grid-cols-2 gap-4">
					<UFormField name="firstname" :label="t('labels.firstname')" required>
						<UInput
							v-model="state.firstname"
							autocomplete="given-name"
							:autofocus="!!idpUserName"
							class="w-full"
							data-testid="firstname-text-input"
						/>
					</UFormField>
					<UFormField name="lastname" :label="t('labels.lastname')" required>
						<UInput
							v-model="state.lastname"
							autocomplete="family-name"
							class="w-full"
							data-testid="lastname-text-input"
						/>
					</UFormField>
				</div>
				<UFormField name="email" :label="t('labels.email')" required>
					<UInput
						v-model="state.email"
						type="email"
						autocomplete="email"
						class="w-full"
						data-testid="email-text-input"
					/>
				</UFormField>
			</div>

			<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />

			<div class="mt-8 flex w-full flex-row items-center justify-between">
				<LoginBackButton />
				<UButton
					type="submit"
					:loading="flow.loading.value"
					:disabled="!canSubmit"
					data-testid="submit-button"
				>
					{{ t("submit") }}
				</UButton>
			</div>
		</UForm>
	</LoginCard>
</template>
