<script setup lang="ts">
/** Copies a value (the TOTP URI) and briefly confirms it (Zitadel login: `CopyToClipboard`). */
const props = defineProps<{ value: string }>();

const copied = ref(false);
let timeout: ReturnType<typeof setTimeout> | undefined;

async function copy() {
	try {
		await navigator.clipboard.writeText(props.value);
	} catch {
		return;
	}
	copied.value = true;
	clearTimeout(timeout);
	timeout = setTimeout(() => {
		copied.value = false;
	}, 1000);
}

onBeforeUnmount(() => clearTimeout(timeout));
</script>

<template>
	<UButton
		type="button"
		variant="link"
		class="px-2"
		:icon="copied ? 'i-lucide-clipboard-check' : 'i-lucide-clipboard'"
		aria-label="Copy to clipboard"
		@click="copy"
	/>
</template>
