<script setup lang="ts">
import type { NuxtError } from "#app";

const props = defineProps<{
	error: NuxtError;
}>();

const t = useTranslations("common");

useBrandingTheme();

useSeoMeta({ title: () => `${props.error.statusCode} | ${t("title")}` });

function backToLogin() {
	clearError({ redirect: "/loginname" });
}
</script>

<template>
	<div class="main-bg-color flex min-h-screen flex-col text-default">
		<UMain class="flex flex-1 items-center justify-center p-4">
			<UPageCard class="w-full max-w-md" :ui="{ container: 'gap-y-6 p-6 sm:p-8' }">
				<div class="flex justify-center">
					<ImgAppLogo class="h-10" />
				</div>
				<div class="flex flex-col items-center gap-2 text-center">
					<h1 class="text-4xl font-semibold text-highlighted">{{ error.statusCode }}</h1>
					<p class="text-sm text-muted">{{ error.statusMessage || error.message }}</p>
				</div>
				<UButton block icon="i-lucide-log-in" @click="backToLogin">
					{{ t("back") }}
				</UButton>
			</UPageCard>
		</UMain>
	</div>
</template>
