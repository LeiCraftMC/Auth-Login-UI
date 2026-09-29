<script setup lang="ts">
/** Live check of a new password against the password policy (Zitadel login: `PasswordComplexity`). */
import type { LoginPasswordComplexity } from "~/utils/loginTypes";

const props = defineProps<{
	passwordComplexitySettings: LoginPasswordComplexity;
	password: string;
	equals: boolean;
}>();

const t = useTranslations("password");

const checks = computed(() => {
	const settings = props.passwordComplexitySettings;
	const password = props.password ?? "";
	const result: { key: string; label: string; matched: boolean; testId: string }[] = [
		{
			key: "length",
			label: t("complexity.length", { minLength: settings.minLength.toString() }),
			matched: password.length >= settings.minLength,
			testId: "length-check",
		},
	];
	if (settings.requiresSymbol) {
		result.push({
			key: "symbol",
			label: t("complexity.hasSymbol"),
			matched: passwordHasSymbol(password),
			testId: "symbol-check",
		});
	}
	if (settings.requiresNumber) {
		result.push({
			key: "number",
			label: t("complexity.hasNumber"),
			matched: passwordHasNumber(password),
			testId: "number-check",
		});
	}
	if (settings.requiresUppercase) {
		result.push({
			key: "uppercase",
			label: t("complexity.hasUppercase"),
			matched: passwordHasUppercase(password),
			testId: "uppercase-check",
		});
	}
	if (settings.requiresLowercase) {
		result.push({
			key: "lowercase",
			label: t("complexity.hasLowercase"),
			matched: passwordHasLowercase(password),
			testId: "lowercase-check",
		});
	}
	result.push({
		key: "equals",
		label: t("complexity.equals"),
		matched: props.equals,
		testId: "equal-check",
	});
	return result;
});
</script>

<template>
	<div class="mb-4 grid grid-cols-2 gap-x-8 gap-y-2">
		<div
			v-for="check in checks"
			:key="check.key"
			class="flex flex-row items-center"
			:data-testid="check.testId"
		>
			<UIcon
				:name="check.matched ? 'i-lucide-check' : 'i-lucide-x'"
				class="mr-2 h-5 w-5 flex-none"
				:class="check.matched ? 'text-green-500' : 'text-error'"
				:aria-label="check.matched ? t('complexity.matches') : t('complexity.doesNotMatch')"
			/>
			<span class="text-sm leading-4 text-muted">{{ check.label }}</span>
		</div>
	</div>
</template>
