<script setup lang="ts">
// The login has no start page of its own: like the Zitadel login, `/` continues with the login name.
const route = useRoute();

await navigateTo({ path: "/loginname", query: route.query }, { replace: true });
</script>

<template>
	<LoginCard loading />
</template>
