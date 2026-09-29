<script setup lang="ts">
/**
 * One authentication method as a link card (Zitadel login: `auth-methods.tsx`). An already set
 * up method is shown dimmed with a check badge and is not clickable.
 */
export type AuthMethodKind = "totp" | "u2f" | "otpEmail" | "otpSms" | "passkey" | "password";

const props = defineProps<{ method: AuthMethodKind; to: string; alreadyAdded?: boolean }>();

const t = useTranslations("authenticator");

const ICONS: Record<AuthMethodKind, string> = {
	totp: "i-lucide-timer",
	u2f: "i-lucide-usb",
	otpEmail: "i-lucide-mail",
	otpSms: "i-lucide-smartphone",
	passkey: "i-lucide-fingerprint-pattern",
	password: "i-lucide-rectangle-ellipsis",
};

const cardClass = computed(() => [
	"group relative flex items-center rounded-md border border-default bg-elevated/50 px-5 py-3 font-medium transition-all",
	props.alreadyAdded ? "cursor-default opacity-50" : "hover:bg-accented/50 hover:shadow-lg",
]);
</script>

<template>
	<div v-if="alreadyAdded" :class="cardClass" :data-testid="`auth-method-${method}`">
		<UIcon :name="ICONS[method]" class="mr-4 h-8 w-8" />
		{{ t(`methods.${method}`) }}
		<UBadge
			color="success"
			variant="subtle"
			icon="i-lucide-check"
			size="sm"
			class="absolute top-2 right-2 rounded-full"
		/>
	</div>
	<NuxtLink v-else :to="to" :class="cardClass" :data-testid="`auth-method-${method}`">
		<UIcon :name="ICONS[method]" class="mr-4 h-8 w-8" />
		{{ t(`methods.${method}`) }}
	</NuxtLink>
</template>
