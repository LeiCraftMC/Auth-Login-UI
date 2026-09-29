<script setup lang="ts">
/**
 * The second factors allowed by the login policy to set up (Zitadel login:
 * `ChooseSecondFactorToSetup`). Email / SMS codes need a verified email / phone. Unless MFA is
 * forced, the setup can be skipped.
 */
import type { LoginAuthMethod, LoginSettings } from "~/utils/loginTypes";

const props = defineProps<{
	userId: string;
	loginName?: string;
	sessionId?: string;
	requestId?: string;
	organization?: string;
	loginSettings: LoginSettings;
	userMethods: LoginAuthMethod[];
	checkAfter: boolean;
	phoneVerified: boolean;
	emailVerified: boolean;
	force: boolean;
}>();

const t = useTranslations("mfa");
const flow = useLoginFlow();

const params = computed(() =>
	buildQuery({
		loginName: props.loginName,
		sessionId: props.sessionId,
		requestId: props.requestId,
		organization: props.organization,
		checkAfter: props.checkAfter ? "true" : undefined,
	}),
);

async function skip() {
	await flow.run(() =>
		useAPI((api) =>
			api.postMfaSkip({
				body: {
					userId: props.userId,
					loginName: props.loginName,
					sessionId: props.sessionId,
					organization: props.organization,
					requestId: props.requestId,
				},
			}),
		),
	);
}
</script>

<template>
	<LoginAutoSubmitForm
		v-if="flow.samlData.value"
		:url="flow.samlData.value.url"
		:fields="flow.samlData.value.fields"
	/>
	<div class="grid w-full grid-cols-1 gap-5 pt-4">
		<template v-for="factor in loginSettings.secondFactors" :key="factor">
			<LoginAuthMethodLink
				v-if="factor === 'otp'"
				method="totp"
				:to="`/otp/time-based/set?${params}`"
				:already-added="userMethods.includes('totp')"
			/>
			<LoginAuthMethodLink
				v-else-if="factor === 'u2f'"
				method="u2f"
				:to="`/u2f/set?${params}`"
				:already-added="userMethods.includes('u2f')"
			/>
			<LoginAuthMethodLink
				v-else-if="factor === 'otp_email' && emailVerified"
				method="otpEmail"
				:to="`/otp/email/set?${params}`"
				:already-added="userMethods.includes('otp_email')"
			/>
			<LoginAuthMethodLink
				v-else-if="factor === 'otp_sms' && phoneVerified"
				method="otpSms"
				:to="`/otp/sms/set?${params}`"
				:already-added="userMethods.includes('otp_sms')"
			/>
		</template>
	</div>

	<UButton
		v-if="!force"
		type="button"
		color="neutral"
		variant="link"
		class="mt-4 px-0"
		:loading="flow.loading.value"
		data-testid="reset-button"
		@click="skip"
	>
		{{ t("set.skip") }}
	</UButton>

	<div v-if="flow.error.value" class="py-4" data-testid="error">
		<LoginAlert>{{ flow.error.value }}</LoginAlert>
	</div>
</template>
