<script setup lang="ts">
/** POSTs the SAML response (or an IdP form) to its target as soon as it is mounted. */
defineProps<{ url: string; fields: Record<string, string> }>();

const form = useTemplateRef<HTMLFormElement>("form");

onMounted(() => {
	form.value?.submit();
});
</script>

<template>
	<form ref="form" :action="url" method="post" class="hidden">
		<input v-for="(value, key) in fields" :key="key" type="hidden" :name="key" :value="value" />
		<noscript>
			<button type="submit">Continue</button>
		</noscript>
	</form>
</template>
