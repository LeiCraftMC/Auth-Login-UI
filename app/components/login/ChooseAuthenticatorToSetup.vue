<script setup lang="ts">
/** The first authenticator to set up (Zitadel login: `ChooseAuthenticatorToSetup`). */
import type { LoginAuthMethod, LoginSettings } from "~/utils/loginTypes";

const props = defineProps<{
	authMethods: LoginAuthMethod[];
	params: string;
	loginSettings: LoginSettings;
}>();

const t = useTranslations("authenticator");

const showPassword = computed(
	() => !props.authMethods.includes("password") && props.loginSettings.allowLocalAuthentication,
);
const showPasskey = computed(
	() => !props.authMethods.includes("passkey") && props.loginSettings.passkeysAllowed,
);
</script>

<template>
	<LoginAlert v-if="authMethods.length !== 0">{{ t("allSetup") }}</LoginAlert>
	<div v-else class="grid w-full grid-cols-1 gap-5 pt-4">
		<LoginAuthMethodLink v-if="showPassword" method="password" :to="`/password/set?${params}`" />
		<LoginAuthMethodLink v-if="showPasskey" method="passkey" :to="`/passkey/set?${params}`" />
	</div>
</template>
