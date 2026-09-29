<script setup lang="ts">
/**
 * /password — password check of the login (Zitadel login: `password/page.tsx` + `PasswordForm`),
 * with the reset link unless the login policy hides it.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("password");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("verify.title") });

const query = useQueryParams("loginName", "organization", "requestId", "sessionId");
const { loginName, organization, requestId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("password", () =>
	useAPI((api) => api.getPassword({ query: { loginName, organization, requestId } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();
const info = ref("");

const schema = computed(() =>
	z.object({ password: z.string().min(1, t("verify.required.password")) }),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ password: "" });

async function onSubmit(event: FormSubmitEvent<Schema>) {
	if (!loginName) return;
	info.value = "";
	await flow.run(() =>
		useAPI((api) =>
			api.postPassword({
				body: {
					loginName,
					password: event.data.password,
					// user discovery uses the organization of the URL, not the default organization
					organization,
					defaultOrganization: page.value?.defaultOrganization,
					requestId,
				},
			}),
		),
	);
}

async function resetPasswordAndContinue() {
	if (!loginName) return;
	info.value = "";
	const result = await flow.run(
		() =>
			useAPI((api) =>
				api.postPasswordReset({
					body: {
						loginName,
						organization,
						defaultOrganization: page.value?.defaultOrganization,
						requestId,
					},
				}),
			),
		{ follow: false },
	);
	if (result === null) return;

	info.value = t("verify.info.passwordResetSent");
	await navigateTo(loginPath("/password/set", { loginName, organization, requestId }));
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("verify.title") }}</template>
		<template #description>{{ t("verify.description") }}</template>
		<template v-if="page?.session || loginName" #header>
			<LoginUserAvatar
				:login-name="loginName ?? page?.session?.factors?.user?.loginName"
				:display-name="page?.session?.factors?.user?.displayName ?? loginName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<!-- Only warn without a loginName to continue with: under enumeration protection there is
			no session by design, and the form still works via the user search on submit. -->
		<div v-else-if="!loginName" class="py-4">
			<LoginAlert>{{ tError("unknownContext") }}</LoginAlert>
		</div>

		<UForm
			v-else-if="page"
			:schema="schema"
			:state="state"
			class="w-full"
			@submit="onSubmit"
			@error="onError"
		>
			<input type="hidden" name="loginName" autocomplete="username" :value="loginName" />
			<UFormField name="password" :label="t('verify.labels.password')">
				<UInput
					v-model="state.password"
					type="password"
					autocomplete="current-password"
					autofocus
					class="w-full"
					data-testid="password-text-input"
				/>
			</UFormField>

			<UButton
				v-if="!page.loginSettings?.hidePasswordReset"
				type="button"
				color="neutral"
				variant="link"
				class="mt-1 px-0"
				:disabled="flow.loading.value"
				data-testid="reset-button"
				@click="resetPasswordAndContinue"
			>
				{{ t("verify.resetPassword") }}
			</UButton>

			<div v-if="info" class="py-4">
				<LoginAlert type="info">{{ info }}</LoginAlert>
			</div>

			<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />

			<div class="mt-8 flex w-full flex-row items-center">
				<LoginBackButton />
				<span class="grow" />
				<UButton
					type="submit"
					:loading="flow.loading.value"
					:disabled="!state.password"
					data-testid="submit-button"
				>
					{{ t("verify.submit") }}
				</UButton>
			</div>
		</UForm>
	</LoginCard>
</template>
