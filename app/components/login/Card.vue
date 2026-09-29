<script setup lang="ts">
/**
 * LoginCard — the branded card every login page renders into (Zitadel login: `DynamicTheme`):
 * the logo of the instance / organization for the current theme (the other theme's logo, or the
 * LeiCraft_MC logo, if it has none), a centered title block and the page content. Hands the page's
 * branding to the layout, which applies it (useBrandingTheme).
 */
import { useBrandingStore } from "~/composables/stores/useBrandingStore";
import type { LoginBranding } from "~/utils/loginTypes";

const props = defineProps<{
	branding?: LoginBranding | null;
	/** The page data is still loading: render a skeleton instead of the slots. */
	loading?: boolean;
}>();

const brandingStore = useBrandingStore();
const colorMode = useColorMode();

watch(
	() => props.branding,
	(branding) => {
		if (branding) brandingStore.update(branding);
	},
	{ immediate: true },
);

// while the next page loads, the previous page's branding keeps the logo in place
const current = computed(() => props.branding ?? brandingStore.data.value);
const logoUrl = computed(() => {
	const branding = current.value;
	if (!branding) return undefined;
	const [own, other] =
		colorMode.value === "dark" ? [branding.dark, branding.light] : [branding.light, branding.dark];
	return own.logoUrl ?? other.logoUrl;
});
</script>

<template>
	<UPageCard class="w-full" :ui="{ container: 'gap-y-6 p-6 sm:p-8' }">
		<div class="flex min-h-10 justify-center">
			<img
				v-if="logoUrl"
				:src="logoUrl"
				alt="logo"
				class="max-h-[150px] max-w-[150px] object-contain"
			/>
			<ImgAppLogo v-else-if="current || !loading" class="h-10" />
		</div>

		<template v-if="loading">
			<div class="flex flex-col items-center gap-3">
				<USkeleton class="h-7 w-2/3" />
				<USkeleton class="h-4 w-full" />
			</div>
			<USkeleton class="h-10 w-full" />
			<div class="flex justify-between">
				<USkeleton class="h-9 w-20" />
				<USkeleton class="h-9 w-24" />
			</div>
		</template>

		<template v-else>
			<div v-if="$slots.title" class="flex flex-col items-center gap-4 text-center">
				<h1 class="text-2xl font-semibold text-highlighted">
					<slot name="title" />
				</h1>
				<p v-if="$slots.description" class="text-sm text-muted">
					<slot name="description" />
				</p>
				<slot name="header" />
			</div>

			<div class="w-full">
				<slot />
			</div>
		</template>
	</UPageCard>
</template>
