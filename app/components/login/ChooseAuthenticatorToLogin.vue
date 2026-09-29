<script setup lang="ts">
/** Alternative primary methods of a user (Zitadel login: `ChooseAuthenticatorToLogin`). */
import type { LoginAuthMethod, LoginSettings } from "~/utils/loginTypes";

const props = defineProps<{
	authMethods: LoginAuthMethod[];
	/** Query of the method links (loginName, requestId, organization, …). */
	params: string;
	loginSettings: LoginSettings | null | undefined;
}>();

const t = useTranslations("idp");

// The Zitadel login references this key but ships no text for it (it renders the key); only show
// it when a custom text provides one.
const alternativeText = computed(() => {
	const text = t("chooseAlternativeMethod");
	return text === "idp.chooseAlternativeMethod" ? "" : text;
});

const showPassword = computed(
	() => props.authMethods.includes("password") && !!props.loginSettings?.allowLocalAuthentication,
);
const showPasskey = computed(
	() =>
		props.authMethods.includes("passkey") &&
		!!props.loginSettings?.allowLocalAuthentication &&
		!!props.loginSettings?.passkeysAllowed,
);
</script>

<template>
	<p v-if="showPassword && alternativeText" class="text-sm text-muted">{{ alternativeText }}</p>
	<div class="grid w-full grid-cols-1 gap-5 pt-4">
		<LoginAuthMethodLink v-if="showPassword" method="password" :to="`/password?${params}`" />
		<LoginAuthMethodLink v-if="showPasskey" method="passkey" :to="`/passkey?${params}`" />
	</div>
</template>
