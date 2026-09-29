<script setup lang="ts">
/**
 * /password/change — a password change the policy requires (expired or admin-set password),
 * then signs in with the new one (Zitadel login: `password/change/page.tsx` + `ChangePasswordForm`).
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("password");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("change.title") });

const query = useQueryParams("loginName", "organization", "requestId", "sessionId");
const { loginName, organization, requestId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("password-change", () =>
	useAPI((api) => api.getPasswordChange({ query: { loginName, organization, requestId } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const session = computed(() => page.value?.session ?? null);
const complexity = computed(() => page.value?.passwordComplexity ?? null);

const schema = computed(() =>
	z.object({
		currentPassword: z.string().min(1, t("change.required.currentPassword")),
		password: z.string().min(1, t("change.required.newPassword")),
		confirmPassword: z.string().min(1, t("change.required.confirmPassword")),
	}),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ currentPassword: "", password: "", confirmPassword: "" });

const canSubmit = computed(
	() =>
		!!complexity.value &&
		passwordMatchesComplexity(state.password, complexity.value) &&
		!!state.currentPassword &&
		!!state.password &&
		state.password === state.confirmPassword,
);

async function onSubmit(event: FormSubmitEvent<Schema>) {
	const sessionId = session.value?.id;
	if (!sessionId || !loginName) return;

	flow.loading.value = true;
	flow.error.value = "";

	const changed = await useAPI((api) =>
		api.postPasswordChange({
			body: {
				sessionId,
				currentPassword: event.data.currentPassword,
				password: event.data.password,
			},
		}),
	);
	if (!changed.success) {
		flow.loading.value = false;
		flow.error.value = changed.message || t("change.errors.couldNotChangePassword");
		return;
	}

	// eventual consistency (as the Zitadel login does)
	await new Promise((resolve) => setTimeout(resolve, 1000));

	await flow.run(() =>
		useAPI((api) =>
			api.postPassword({
				body: { loginName, password: event.data.password, organization, requestId },
			}),
		),
	);
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("change.title") }}</template>
		<template #description>{{ t("change.description") }}</template>
		<template #header>
			<!-- A failed session lookup is reported by the form gate below (failedLoading). -->
			<div v-if="!loginName" class="w-full py-4">
				<LoginAlert>{{ tError("unknownContext") }}</LoginAlert>
			</div>
			<LoginUserAvatar
				v-if="session || loginName"
				:login-name="loginName ?? session?.factors?.user?.loginName"
				:display-name="session?.factors?.user?.displayName ?? loginName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<UForm
			v-else-if="complexity && loginName && session?.factors?.user?.id"
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
					:value="loginName"
					readonly
					tabindex="-1"
					aria-hidden="true"
					class="sr-only"
				/>

				<UFormField name="currentPassword" :label="t('change.labels.currentPassword')" required>
					<UInput
						v-model="state.currentPassword"
						type="password"
						autocomplete="current-password"
						autofocus
						class="w-full"
						data-testid="password-change-current-text-input"
					/>
				</UFormField>

				<UFormField name="password" :label="t('change.labels.newPassword')" required>
					<UInput
						v-model="state.password"
						type="password"
						autocomplete="new-password"
						class="w-full"
						data-testid="password-change-text-input"
					/>
				</UFormField>

				<UFormField name="confirmPassword" :label="t('change.labels.confirmPassword')" required>
					<UInput
						v-model="state.confirmPassword"
						type="password"
						autocomplete="new-password"
						class="w-full"
						data-testid="password-change-confirm-text-input"
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
					{{ t("change.submit") }}
				</UButton>
			</div>
		</UForm>

		<div v-else-if="page" class="py-4">
			<LoginAlert>{{ tError("failedLoading") }}</LoginAlert>
		</div>
	</LoginCard>
</template>
