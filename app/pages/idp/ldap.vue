<script setup lang="ts">
/**
 * /idp/ldap — username and password of an LDAP identity provider (Zitadel login: `idp/ldap/page.tsx`
 * + `LDAPUsernamePasswordForm`). Continues at /idp/ldap/process like any other IdP callback.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const t = useTranslations("ldap");
useSeoMeta({ title: () => t("title") });

const query = useQueryParams(
	"idpId",
	"organization",
	"link",
	"requestId",
	"postErrorRedirectUrl",
	"linkToSessionId",
	"linkFingerprint",
);
const { idpId, organization, requestId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("idp-ldap", () =>
	useAPI((api) => api.getIdpLdap({ query: { idpId, organization } })),
);

const flow = useLoginFlow();
const onError = await useDefaultOnFormError();

const schema = computed(() =>
	z.object({
		loginName: z.string().trim().min(1, t("required.username")),
		password: z.string().min(1, t("required.password")),
	}),
);
type Schema = z.output<typeof schema.value>;

const state = reactive({ loginName: "", password: "" });

async function onSubmit(event: FormSubmitEvent<Schema>) {
	if (!idpId) return;
	await flow.run(() =>
		useAPI((api) =>
			api.postIdpLdap({
				body: {
					idpId,
					username: event.data.loginName,
					password: event.data.password,
					link: query.link === "true",
					requestId,
					organization,
					postErrorRedirectUrl: query.postErrorRedirectUrl,
					linkToSessionId: query.linkToSessionId,
					linkFingerprint: query.linkFingerprint,
				},
			}),
		),
	);
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("title") }}</template>
		<template #description>{{ t("description") }}</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<UForm
			v-else-if="page"
			:schema="schema"
			:state="state"
			class="w-full space-y-4"
			@submit="onSubmit"
			@error="onError"
		>
			<UFormField name="loginName" :label="t('labels.username')">
				<UInput
					v-model="state.loginName"
					autocomplete="username"
					autocapitalize="none"
					autocorrect="off"
					:spellcheck="false"
					autofocus
					class="w-full"
					data-testid="username-text-input"
				/>
			</UFormField>
			<UFormField name="password" :label="t('labels.password')">
				<UInput
					v-model="state.password"
					type="password"
					autocomplete="current-password"
					class="w-full"
					data-testid="password-text-input"
				/>
			</UFormField>

			<LoginFlowState :error="flow.error.value" />

			<div class="mt-8 flex w-full flex-row items-center">
				<LoginBackButton />
				<span class="grow" />
				<UButton
					type="submit"
					:loading="flow.loading.value"
					:disabled="!state.loginName.trim() || !state.password"
					data-testid="submit-button"
				>
					{{ t("submit") }}
				</UButton>
			</div>
		</UForm>
	</LoginCard>
</template>
