<script setup lang="ts">
const links = [
	{ label: "Impressum", to: "https://legal.leicraftmc.de/impressum/" },
	{ label: "Datenschutz", to: "https://legal.leicraftmc.de/datenschutz/" },
];
</script>

<template>
	<nav class="flex items-center gap-3 text-xs text-muted">
		<ULink
			v-for="link in links"
			:key="link.label"
			:to="link.to"
			target="_blank"
			class="transition-colors hover:text-primary"
		>
			{{ link.label }}
		</ULink>
	</nav>
</template>
