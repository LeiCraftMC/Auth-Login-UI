<script setup lang="ts">
/**
 * Sign in (or link) with the active identity providers (Zitadel login: `SignInWithIdp`). A click
 * starts the IdP intent; the user is sent to the provider (or to the LDAP form).
 */
import type { LoginIdentityProvider, LoginIdpSlug } from "~/utils/loginTypes";

const props = withDefaults(
	defineProps<{
		identityProviders: LoginIdentityProvider[];
		requestId?: string;
		organization?: string;
		/** Link the IdP to this session's user instead of signing in. */
		sessionId?: string;
		postErrorRedirectUrl?: string;
		/** Forwarded to the IdP as login_hint so the user does not type the identifier again. */
		loginHint?: string;
		showLabel?: boolean;
	}>(),
	{ showLabel: true },
);

const t = useTranslations("idp");
const flow = useLoginFlow();
const pendingId = ref<string | null>(null);

const BRAND_LABEL_KEYS: Partial<Record<LoginIdpSlug, string>> = {
	apple: "signInWithApple",
	google: "signInWithGoogle",
	azure: "signInWithAzureAD",
	github: "signInWithGithub",
	github_es: "signInWithGithub",
	gitlab: "signInWithGitlab",
	gitlab_es: "signInWithGitlab",
	zitadel: "signInWithZitadel",
};

function label(idp: LoginIdentityProvider) {
	if (idp.name) return idp.name;
	const key = BRAND_LABEL_KEYS[idp.type];
	return key ? t(key) : "";
}

/** OIDC, OAuth, SAML, LDAP and JWT providers have no brand: their name is centered. */
function isGeneric(idp: LoginIdentityProvider) {
	return !BRAND_LABEL_KEYS[idp.type];
}

async function start(idp: LoginIdentityProvider) {
	pendingId.value = idp.id;
	await flow.run(() =>
		useAPI((api) =>
			api.postIdpStart({
				body: {
					id: idp.id,
					provider: idp.type,
					requestId: props.requestId,
					organization: props.organization,
					sessionId: props.sessionId,
					postErrorRedirectUrl: props.postErrorRedirectUrl,
					loginHint: props.loginHint,
				},
			}),
		),
	);
	pendingId.value = null;
}
</script>

<template>
	<div class="flex w-full flex-col gap-2 text-sm">
		<LoginAutoSubmitForm
			v-if="flow.samlData.value"
			:url="flow.samlData.value.url"
			:fields="flow.samlData.value.fields"
		/>

		<div v-if="showLabel" class="flex items-center gap-3 text-muted">
			<USeparator class="flex-1" />
			<span class="shrink-0">{{ t("orSignInWith") }}</span>
			<USeparator class="flex-1" />
		</div>

		<UButton
			v-for="idp in identityProviders"
			:key="idp.id"
			type="button"
			color="neutral"
			variant="outline"
			size="lg"
			class="min-h-12 w-full"
			:class="isGeneric(idp) ? 'justify-center' : 'justify-start'"
			:loading="pendingId === idp.id"
			:disabled="!!pendingId"
			:data-testid="`idp-${idp.type}`"
			@click="start(idp)"
		>
			<template v-if="!isGeneric(idp)" #leading>
				<span class="flex h-8 w-8 items-center justify-center">
					<ImgIdpLogo :type="idp.type" />
				</span>
			</template>
			<span :class="isGeneric(idp) ? 'text-center' : 'ml-2'">{{ label(idp) }}</span>
		</UButton>

		<div v-if="flow.error.value" class="py-4">
			<LoginAlert>{{ flow.error.value }}</LoginAlert>
		</div>
	</div>
</template>
