<script setup lang="ts">
/** Inline message of a login page (Zitadel login: `Alert` — ALERT = warning, INFO = neutral). */
withDefaults(defineProps<{ type?: "alert" | "info" }>(), { type: "alert" });
</script>

<template>
	<UAlert
		:color="type === 'alert' ? 'warning' : 'neutral'"
		variant="subtle"
		:icon="type === 'alert' ? 'i-lucide-triangle-alert' : 'i-lucide-info'"
		:ui="{ title: 'text-sm font-normal' }"
	>
		<template #title>
			<slot />
		</template>
	</UAlert>
</template>
