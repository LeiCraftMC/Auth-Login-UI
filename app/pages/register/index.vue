<script setup lang="ts">
/**
 * /register — self-registration (Zitadel login: `register/page.tsx` + `RegisterForm`). With a
 * password the user continues at /register/password, with a passkey the account is created here.
 * IdPs that may create accounts are offered below the form.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

type Method = "passkey" | "password";

const t = useTranslations("register");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("title") });

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
} = await useLoginPage("register", () =>
	useAPI((api) => api.getRegister({ query: { organization, requestId } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const settings = computed(() => page.value?.loginSettings ?? null);
const disabled = computed(
	() =>
		!!settings.value &&
		!settings.value.allowRegister &&
		(!settings.value.allowExternalIdp || page.value?.identityProviders.length === 0),
);
const idpCount = computed(() =>
	settings.value?.allowExternalIdp ? (page.value?.identityProviders.length ?? 0) : 0,
);
const bothMethods = computed(
	() => !!settings.value?.allowLocalAuthentication && !!settings.value?.passkeysAllowed,
);
const legalRequired = computed(
	() => !!(page.value?.legal?.tosLink || page.value?.legal?.privacyPolicyLink),
);

const methods: { value: Method; icon: string }[] = [
	{ value: "passkey", icon: "i-lucide-fingerprint-pattern" },
	{ value: "password", icon: "i-lucide-rectangle-ellipsis" },
];
const selected = ref<Method>("passkey");
const tosAndPolicyAccepted = ref(false);

const schema = computed(() =>
	z.object({
		firstname: z.string().trim().min(1, t("required.firstname")),
		lastname: z.string().trim().min(1, t("required.lastname")),
		email: z.string().trim().min(1, t("required.email")),
	}),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({
	firstname: firstname ?? "",
	lastname: lastname ?? "",
	email: email ?? "",
});

const canSubmit = computed(
	() =>
		!!state.firstname.trim() &&
		!!state.lastname.trim() &&
		!!state.email.trim() &&
		(!legalRequired.value || tosAndPolicyAccepted.value),
);

async function onSubmit(event: FormSubmitEvent<Schema>) {
	const org = page.value?.organization;
	if (!org) return;

	// both allowed: the selection decides; otherwise password whenever local authentication is on
	const withPassword = bothMethods.value
		? selected.value !== "passkey"
		: !!settings.value?.allowLocalAuthentication;

	if (withPassword) {
		await navigateTo(
			loginPath("/register/password", { ...event.data, organization: org, requestId }),
		);
		return;
	}

	await flow.run(() =>
		useAPI((api) =>
			api.postRegister({
				body: {
					email: event.data.email,
					firstName: event.data.firstname,
					lastName: event.data.lastname,
					organization: org,
					requestId,
				},
			}),
		),
	);
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template v-if="page && !settings" #title>{{ t("title") }}</template>
		<template v-else-if="disabled" #title>{{ t("disabled.title") }}</template>
		<template v-else #title>{{ t("title") }}</template>

		<template v-if="page && !settings" #header>
			<LoginAlert>{{ tError("unknownContext") }}</LoginAlert>
		</template>
		<template v-else-if="disabled" #description>{{ t("disabled.description") }}</template>
		<template v-else #description>{{ t("description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<template v-else-if="page && settings && !disabled">
			<LoginAlert v-if="!page.organization">{{ tError("unknownContext") }}</LoginAlert>

			<UForm
				v-if="page.legal && page.passwordComplexity && page.organization && settings.allowLocalAuthentication"
				:schema="schema"
				:state="state"
				class="w-full"
				@submit="onSubmit"
				@error="onError"
			>
				<div class="mb-4 grid grid-cols-2 gap-4">
					<UFormField name="firstname" :label="t('labels.firstname')" required>
						<UInput
							v-model="state.firstname"
							autocomplete="given-name"
							autofocus
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
					<UFormField name="email" :label="t('labels.email')" required class="col-span-2">
						<UInput
							v-model="state.email"
							type="email"
							autocomplete="email"
							class="w-full"
							data-testid="email-text-input"
						/>
					</UFormField>
				</div>

				<LoginPrivacyPolicyCheckboxes
					v-if="legalRequired"
					:legal="page.legal"
					@change="(accepted) => (tosAndPolicyAccepted = accepted)"
				/>

				<!-- the chooser only when both methods are allowed -->
				<template v-if="bothMethods">
					<p class="mt-4 mb-6 block text-left text-sm text-muted">{{ t("selectMethod") }}</p>
					<div class="flex flex-row gap-4 pb-4" role="radiogroup">
						<button
							v-for="method in methods"
							:key="method.value"
							type="button"
							role="radio"
							:aria-checked="selected === method.value"
							class="flex flex-1 cursor-pointer flex-col items-center rounded-lg border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm transition-all hover:bg-white/10 hover:shadow-lg"
							:class="selected === method.value ? 'ring-2 ring-primary' : ''"
							:data-testid="`${method.value}-radio`"
							@click="selected = method.value"
						>
							<UIcon :name="method.icon" class="mb-3 h-8 w-8" />
							{{ t(`methods.${method.value}`) }}
						</button>
					</div>
				</template>

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

			<div
				v-if="!settings.allowLocalAuthentication && !settings.passkeysAllowed && !idpCount"
				class="py-4"
			>
				<LoginAlert type="info">{{ t("noMethodAvailableWarning") }}</LoginAlert>
			</div>

			<LoginIdpButtons
				v-if="settings.allowExternalIdp && page.identityProviders.length"
				:identity-providers="page.identityProviders"
				:request-id="requestId"
				:organization="page.organization"
			/>
		</template>
	</LoginCard>
</template>
