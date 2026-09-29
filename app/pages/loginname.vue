<script setup lang="ts">
/**
 * /loginname — user discovery, the first login step (Zitadel login: `loginname/page.tsx` +
 * `UsernameForm`). `?submit=true` with a `loginName` continues right away.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("loginname");
useSeoMeta({ title: () => t("title") });

const { loginName, requestId, organization, orgDomain, submit } = useQueryParams(
	"loginName",
	"requestId",
	"organization",
	"orgDomain",
	"submit",
);

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("loginname", () =>
	useAPI((api) => api.getLoginname({ query: { loginName, requestId, organization, orgDomain } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const schema = computed(() =>
	z.object({ loginName: z.string().trim().min(1, t("required.loginName")) }),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ loginName: loginName ?? "" });

const inputLabel = computed(() => {
	const settings = page.value?.loginSettings;
	if (settings?.disableLoginWithEmail && settings?.disableLoginWithPhone)
		return t("labels.username");
	if (settings?.disableLoginWithEmail) return t("labels.usernameOrPhoneNumber");
	if (settings?.disableLoginWithPhone) return t("labels.usernameOrEmail");
	return t("labels.loginname");
});

async function submitLoginName(value: string) {
	await flow.run(() =>
		useAPI((api) =>
			api.postLoginname({
				body: {
					loginName: value,
					// user discovery uses the organization of the URL, not the default organization
					organization,
					defaultOrganization: page.value?.defaultOrganization,
					requestId,
					suffix: orgDomain,
				},
			}),
		),
	);
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
	await submitLoginName(event.data.loginName);
}

watch(
	page,
	(loaded) => {
		if (loaded && submit === "true" && loginName) {
			submitLoginName(loginName);
		}
	},
	{ once: true },
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("title") }}</template>
		<template #description>{{ t("description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<template v-else-if="page">
			<UForm
				v-if="page.loginSettings?.allowLocalAuthentication"
				:schema="schema"
				:state="state"
				class="w-full"
				@submit="onSubmit"
				@error="onError"
			>
				<UFormField name="loginName" :label="inputLabel">
					<UInput
						v-model="state.loginName"
						autocomplete="username"
						autocapitalize="none"
						autocorrect="off"
						:spellcheck="false"
						autofocus
						class="w-full"
						data-testid="username-text-input"
					>
						<template v-if="orgDomain && !page.branding.hideLoginNameSuffix" #trailing>
							<span class="text-sm text-muted">@{{ orgDomain }}</span>
						</template>
					</UInput>
				</UFormField>

				<UButton
					v-if="page.loginSettings.allowRegister"
					:to="loginPath('/register', { organization, requestId })"
					color="neutral"
					variant="link"
					class="mt-1 px-0"
					:disabled="flow.loading.value"
					data-testid="register-button"
				>
					{{ t("register") }}
				</UButton>

				<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />

				<div class="mt-4 flex w-full flex-row items-center">
					<LoginBackButton />
					<span class="grow" />
					<UButton
						type="submit"
						:loading="flow.loading.value"
						:disabled="!state.loginName.trim()"
						data-testid="submit-button"
					>
						{{ t("submit") }}
					</UButton>
				</div>
			</UForm>

			<div
				v-if="page.loginSettings?.allowExternalIdp && page.identityProviders.length"
				class="w-full pt-6 pb-4"
			>
				<LoginIdpButtons
					:identity-providers="page.identityProviders"
					:request-id="requestId"
					:organization="organization"
					post-error-redirect-url="/loginname"
					:login-hint="page.idpLoginHint"
					:show-label="page.loginSettings.allowLocalAuthentication"
				/>
			</div>
		</template>
	</LoginCard>
</template>
