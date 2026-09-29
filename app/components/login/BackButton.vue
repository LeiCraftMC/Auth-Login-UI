<script setup lang="ts">
const router = useRouter();
const t = useTranslations("common");
</script>

<template>
	<UButton type="button" color="neutral" variant="subtle" data-testid="back-button" @click="router.back()">
		{{ t("back") }}
	</UButton>
</template>
