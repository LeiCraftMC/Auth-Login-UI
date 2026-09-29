<script setup lang="ts">
/**
 * An account of this browser (Zitadel login: `SessionItem`): a still valid session continues
 * directly, otherwise the login restarts with its login name. The x ends the session.
 */
import type { LoginSession } from "~/utils/loginTypes";

const props = defineProps<{ session: LoginSession; requestId?: string }>();
const emit = defineEmits<{ removed: [] }>();

const t = useTranslations("accounts");
const tError = useTranslations("error");
const locale = useLoginLocale();
const flow = useLoginFlow();

const state = computed(() => sessionPrimaryFactorState(props.session));
const user = computed(() => props.session.factors?.user);
const expiresText = computed(() =>
	props.session.expirationDate
		? `Expires ${formatRelativeTime(props.session.expirationDate, locale.value)}`
		: "",
);

async function select() {
	const current = user.value;
	if (!current) return;

	if (state.value.valid) {
		await flow.run(() =>
			useAPI((api) =>
				api.postSessionContinue({
					body: { sessionId: props.session.id, requestId: props.requestId },
				}),
			),
		);
		return;
	}

	await flow.run(() =>
		useAPI((api) =>
			api.postLoginname({
				body: {
					loginName: current.loginName,
					organization: current.organizationId,
					requestId: props.requestId,
				},
			}),
		),
	);
}

async function clear() {
	flow.error.value = "";
	const result = await useAPI((api) =>
		api.deleteSessionBySessionId({ path: { sessionId: props.session.id } }),
	);
	if (!result.success) {
		flow.error.value = result.message || tError("couldNotClearSession");
		return;
	}
	emit("removed");
}
</script>

<template>
	<UTooltip :disabled="!state.valid || !expiresText" :text="expiresText" :delay-duration="300">
		<button
			type="button"
			class="group flex w-full flex-row items-center rounded-md border border-default bg-elevated/50 px-4 py-2 text-left transition-all hover:bg-accented/50 hover:shadow-lg disabled:opacity-60"
			:disabled="flow.loading.value"
			@click="select"
		>
			<div class="pr-4">
				<LoginAvatar
					size="small"
					:login-name="user?.loginName ?? ''"
					:name="user?.displayName ?? ''"
				/>
			</div>

			<div class="flex flex-col items-start overflow-hidden">
				<span>{{ user?.displayName }}</span>
				<span class="truncate text-xs opacity-80">{{ user?.loginName }}</span>
				<span v-if="state.valid" class="truncate text-xs opacity-80">
					{{ t("verified") }}
					{{ state.verifiedAt ? formatRelativeTime(state.verifiedAt, locale) : "" }}
				</span>
				<span v-else-if="state.verifiedAt" class="truncate text-xs opacity-80">
					{{ t("expired") }}
					{{ session.expirationDate ? formatRelativeTime(session.expirationDate, locale) : "" }}
				</span>
			</div>

			<span class="grow" />
			<div class="relative flex flex-row items-center">
				<div
					class="absolute right-6 mx-2 h-2 w-2 rounded-full transition-all sm:right-0 sm:group-hover:right-6"
					:class="state.valid ? 'bg-green-500' : 'bg-red-500'"
				/>
				<UIcon
					name="i-lucide-circle-x"
					class="h-5 w-5 opacity-50 transition-all hover:opacity-100 sm:hidden sm:group-hover:block"
					data-testid="clear-session"
					@click.stop.prevent="clear"
				/>
			</div>
		</button>
	</UTooltip>
	<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />
</template>
