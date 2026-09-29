<script setup lang="ts">
/** Initials (or picture) of a user, colored by the login name (Zitadel login: `Avatar`). */
const props = withDefaults(
	defineProps<{
		name?: string | null;
		loginName: string;
		imageUrl?: string;
		size?: "small" | "base" | "large";
	}>(),
	{ size: "base" },
);

const colorMode = useColorMode();

// dark shade with light text in the dark theme, the other way round in the light theme
const style = computed(() => {
	const color = avatarColor(props.loginName);
	return colorMode.value === "dark"
		? { backgroundColor: color.background, color: color.text }
		: { backgroundColor: color.text, color: color.background };
});
const text = computed(() => initials(props.name ?? props.loginName, props.loginName));
</script>

<template>
	<div
		class="pointer-events-none flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold uppercase"
		:class="{
			'h-8 w-8 text-[13px]': size === 'small',
			'h-[38px] w-[38px] text-[13px]': size === 'base',
			'h-20 w-20 text-xl font-normal': size === 'large',
		}"
		:style="style"
	>
		<img v-if="imageUrl" :src="imageUrl" alt="avatar" class="h-full w-full object-cover" />
		<span v-else>{{ text }}</span>
	</div>
</template>
