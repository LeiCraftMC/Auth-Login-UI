<script setup lang="ts">
/** The configured second factors of a user to verify with (Zitadel login: `ChooseSecondFactor`). */
import type { LoginAuthMethod } from "~/utils/loginTypes";

const props = defineProps<{
	loginName?: string;
	sessionId?: string;
	requestId?: string;
	organization?: string;
	userMethods: LoginAuthMethod[];
}>();

const params = computed(() =>
	buildQuery({
		loginName: props.loginName,
		sessionId: props.sessionId,
		requestId: props.requestId,
		organization: props.organization,
	}),
);
</script>

<template>
	<div class="grid w-full grid-cols-1 gap-5 pt-4">
		<template v-for="method in userMethods" :key="method">
			<LoginAuthMethodLink v-if="method === 'totp'" method="totp" :to="`/otp/time-based?${params}`" />
			<LoginAuthMethodLink v-else-if="method === 'u2f'" method="u2f" :to="`/u2f?${params}`" />
			<LoginAuthMethodLink
				v-else-if="method === 'otp_email'"
				method="otpEmail"
				:to="`/otp/email?${params}`"
			/>
			<LoginAuthMethodLink v-else-if="method === 'otp_sms'" method="otpSms" :to="`/otp/sms?${params}`" />
		</template>
	</div>
</template>
