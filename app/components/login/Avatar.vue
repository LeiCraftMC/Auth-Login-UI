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

const color = computed(() => avatarColor(props.loginName));
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
		:style="{ backgroundColor: color.background, color: color.text }"
	>
		<img v-if="imageUrl" :src="imageUrl" alt="avatar" class="h-full w-full object-cover" />
		<span v-else>{{ text }}</span>
	</div>
</template>
