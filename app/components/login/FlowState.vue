<script setup lang="ts">
/** The error message and the pending SAML POST of a {@link useLoginFlow} step. */
import type { LoginSamlData } from "~/utils/loginTypes";

defineProps<{ error?: string; samlData?: LoginSamlData | null }>();
</script>

<template>
	<LoginAutoSubmitForm v-if="samlData" :url="samlData.url" :fields="samlData.fields" />
	<div v-if="error" class="py-4" data-testid="error">
		<LoginAlert>{{ error }}</LoginAlert>
	</div>
</template>
