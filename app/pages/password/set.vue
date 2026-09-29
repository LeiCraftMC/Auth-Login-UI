<script setup lang="ts">
/**
 * /password/set — set a password with the emailed code (reset / invite), or without a code for
 * `?initial=true` (Zitadel login: `password/set/page.tsx` + `SetPasswordForm`). Signs in with the
 * new password afterwards.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("password");
const tError = useTranslations("error");
const tLoginname = useTranslations("loginname");
useSeoMeta({ title: () => t("set.title") });

const query = useQueryParams(
	"userId",
	"loginName",
	"organization",
	"requestId",
	"code",
	"initial",
	"sessionId",
);
const { userId, loginName, organization, requestId, code, initial } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("password-set", () =>
	useAPI((api) =>
		api.getPasswordSet({ query: { userId, loginName, organization, requestId, code, initial } }),
	),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const form = computed(() => page.value?.form ?? null);
const complexity = computed(() => page.value?.passwordComplexity ?? null);

const schema = computed(() =>
	z.object({
		code: form.value?.codeRequired
			? z.string().trim().min(1, t("set.required.code"))
			: z.string().optional(),
		password: z.string().min(1, t("set.required.newPassword")),
		confirmPassword: z.string().min(1, t("set.required.confirmPassword")),
	}),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ code: code ?? "", password: "", confirmPassword: "" });

const canSubmit = computed(
	() =>
		!!complexity.value &&
		passwordMatchesComplexity(state.password, complexity.value) &&
		(!form.value?.codeRequired || !!state.code.trim()) &&
		!!state.password &&
		state.password === state.confirmPassword,
);

async function resendCode() {
	if (!form.value) return;
	await flow.run(
		() =>
			useAPI((api) =>
				api.postPasswordReset({
					body: {
						loginName: form.value?.loginName ?? "",
						organization,
						defaultOrganization: page.value?.defaultOrganization,
						requestId,
					},
				}),
			),
		{ follow: false },
	);
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
	const current = form.value;
	if (!current) return;

	flow.loading.value = true;
	flow.error.value = "";

	const changed = await useAPI((api) =>
		api.postPasswordSet({
			body: {
				userId: current.userId,
				password: event.data.password,
				organization,
				// not required for the initial password setup
				...(current.codeRequired && { code: event.data.code }),
			},
		}),
	);
	if (!changed.success) {
		flow.loading.value = false;
		flow.error.value = changed.message || t("set.errors.couldNotSetPassword");
		return;
	}

	// eventual consistency of an initial password (as the Zitadel login does)
	await new Promise((resolve) => setTimeout(resolve, 2000));

	await flow.run(() =>
		useAPI((api) =>
			api.postPassword({
				body: {
					loginName: current.loginName,
					password: event.data.password,
					organization,
					requestId,
				},
			}),
		),
	);
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ page?.session?.factors?.user?.displayName ?? t("set.title") }}</template>
		<template #description>{{ t("set.description") }}</template>
		<template #header>
			<!-- A missing session is expected here: the set/reset flow works via code + userId, and
				under enumeration protection no session exists by design. -->
			<div v-if="!loginName && !userId" class="w-full py-4">
				<LoginAlert>{{ tError("unknownContext") }}</LoginAlert>
			</div>
			<LoginUserAvatar
				v-if="page?.session || loginName"
				:login-name="loginName ?? page?.session?.factors?.user?.loginName"
				:display-name="page?.session?.factors?.user?.displayName ?? loginName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<div v-else-if="page?.error" class="py-4">
			<LoginAlert>{{ tLoginname(`errors.${page.error}`) }}</LoginAlert>
		</div>

		<template v-else-if="page">
			<LoginAlert v-if="!initial" type="info">{{ t("set.codeSent") }}</LoginAlert>

			<UForm
				v-if="form && complexity"
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
						:value="form.loginName"
						readonly
						tabindex="-1"
						aria-hidden="true"
						class="sr-only"
					/>

					<LoginAlert v-if="form.codeRequired" type="info">
						<div class="flex flex-row">
							<span class="mr-auto flex-1 text-left">{{ t("set.noCodeReceived") }}</span>
							<UButton
								type="button"
								variant="link"
								class="ml-4 p-0"
								:aria-label="t('set.resend')"
								:disabled="flow.loading.value"
								data-testid="resend-button"
								@click="resendCode"
							>
								{{ t("set.resend") }}
							</UButton>
						</div>
					</LoginAlert>

					<UFormField v-if="form.codeRequired" name="code" :label="t('set.labels.code')" required>
						<UInput
							v-model="state.code"
							autocomplete="one-time-code"
							autofocus
							class="w-full"
							data-testid="code-text-input"
						/>
					</UFormField>

					<UFormField name="password" :label="t('set.labels.newPassword')" required>
						<UInput
							v-model="state.password"
							type="password"
							autocomplete="new-password"
							:autofocus="!form.codeRequired"
							class="w-full"
							data-testid="password-set-text-input"
						/>
					</UFormField>

					<UFormField name="confirmPassword" :label="t('set.labels.confirmPassword')" required>
						<UInput
							v-model="state.confirmPassword"
							type="password"
							autocomplete="new-password"
							class="w-full"
							data-testid="password-set-confirm-text-input"
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
						{{ t("set.submit") }}
					</UButton>
				</div>
			</UForm>

			<div v-else class="py-4">
				<LoginAlert>{{ tError("failedLoading") }}</LoginAlert>
			</div>
		</template>
	</LoginCard>
</template>
