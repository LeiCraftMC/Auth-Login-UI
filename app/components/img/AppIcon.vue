<script setup lang="ts">
const { baseURL } = useRuntimeAppConfigs();
</script>

<template>
	<img :src="`${baseURL}/static/logo/icon.svg`" alt="LeiCraftMC" />
</template>
