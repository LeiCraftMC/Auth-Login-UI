<script setup lang="ts">
/**
 * Terms of service / privacy policy consent of the registration (Zitadel login:
 * `PrivacyPolicyCheckboxes`). Emits whether every linked document was accepted.
 */
import type { LoginLegal } from "~/utils/loginTypes";

const props = defineProps<{ legal: LoginLegal }>();
const emit = defineEmits<{ change: [allAccepted: boolean] }>();

const t = useTranslations("register");
const locale = useLoginLocale();

const tosAccepted = ref(false);
const privacyPolicyAccepted = ref(false);

const helpLink = computed(() => resolveLocalizedLegalLink(props.legal.helpLink, locale.value));
const tosLink = computed(() => resolveLocalizedLegalLink(props.legal.tosLink, locale.value));
const privacyPolicyLink = computed(() =>
	resolveLocalizedLegalLink(props.legal.privacyPolicyLink, locale.value),
);

watch([tosAccepted, privacyPolicyAccepted], ([tos, privacy]) => {
	emit("change", (!tosLink.value || tos) && (!privacyPolicyLink.value || privacy));
});
</script>

<template>
	<p class="mt-4 flex flex-row items-center text-sm text-muted">
		{{ t("agreeTo") }}
		<ULink
			v-if="helpLink"
			:to="helpLink"
			target="_blank"
			aria-label="Open help in a new tab"
			data-testid="help-link"
			class="ml-1 inline-flex"
		>
			<UIcon name="i-lucide-circle-question-mark" class="h-5 w-5" />
		</ULink>
	</p>

	<div v-if="tosLink" class="mt-4 flex items-center gap-4">
		<UCheckbox v-model="tosAccepted" data-testid="tos-checkbox" />
		<ULink :to="tosLink" target="_blank" class="text-sm underline" data-testid="tos-link">
			{{ t("termsOfService") }}
		</ULink>
	</div>

	<div v-if="privacyPolicyLink" class="mt-4 flex items-center gap-4">
		<UCheckbox v-model="privacyPolicyAccepted" data-testid="privacy-policy-checkbox" />
		<ULink
			:to="privacyPolicyLink"
			target="_blank"
			class="text-sm underline"
			data-testid="privacy-policy-link"
		>
			{{ t("privacyPolicy") }}
		</ULink>
	</div>
</template>
