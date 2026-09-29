<script setup lang="ts">
/**
 * Light / system / dark switch (Zitadel login: `ThemeSwitch`); hidden when the branding forces a
 * theme mode.
 */
import { useBrandingStore } from "~/composables/stores/useBrandingStore";

const branding = useBrandingStore().data;
const colorMode = useColorMode();

const visible = computed(() => {
	const mode = branding.value?.themeMode;
	return mode !== "light" && mode !== "dark";
});

const options: { value: ThemeChoice; icon: string; label: string }[] = [
	{ value: "light", icon: "i-lucide-sun", label: "Switch to light mode" },
	{ value: "system", icon: "i-lucide-monitor", label: "Switch to system mode" },
	{ value: "dark", icon: "i-lucide-moon", label: "Switch to dark mode" },
];

function select(choice: ThemeChoice) {
	saveThemeChoice(choice);
	colorMode.preference = choice;
}
</script>

<template>
	<div v-if="visible" class="flex gap-1 rounded-md bg-elevated/60 p-1" data-testid="theme-switch">
		<UButton
			v-for="option in options"
			:key="option.value"
			type="button"
			size="xs"
			:icon="option.icon"
			:color="colorMode.preference === option.value ? 'primary' : 'neutral'"
			:variant="colorMode.preference === option.value ? 'soft' : 'ghost'"
			:aria-label="option.label"
			@click="select(option.value)"
		/>
	</div>
</template>
