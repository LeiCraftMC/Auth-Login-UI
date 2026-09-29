<script setup lang="ts">
/**
 * /passkey/set — register a passkey, for a session or for a user with the registration code of
 * an email link (`code` + `codeId`, registered right away), then log in with it (Zitadel login:
 * `passkey/set/page.tsx` + `RegisterPasskey`).
 */
const t = useTranslations("passkey");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("set.title") });

const query = useQueryParams(
	"userId",
	"loginName",
	"prompt",
	"organization",
	"requestId",
	"code",
	"codeId",
	"sessionId",
);
const { userId, loginName, prompt, organization, requestId, code, codeId } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("passkey-set", () =>
	useAPI((api) => api.getPasskeySet({ query: { userId, loginName, organization, requestId } })),
);

const flow = useLoginFlow();

const sessionId = computed(() => page.value?.session?.id);
const initialLoginName = computed(
	() => loginName ?? page.value?.session?.factors?.user?.loginName ?? page.value?.user?.loginName,
);

async function continueAndLogin(verifiedLoginName?: string) {
	await navigateTo(
		loginPath("/passkey", {
			organization,
			requestId,
			sessionId: sessionId.value,
			userId,
			loginName: verifiedLoginName ?? initialLoginName.value,
		}),
	);
}

async function submitRegisterAndContinue() {
	if (!sessionId.value && !userId) {
		flow.error.value = "Missing session or user information";
		return;
	}
	if (!sessionId.value && !(code && codeId)) {
		flow.error.value = "Missing code for user-based registration";
		return;
	}

	const registration = await flow.run(
		() =>
			useAPI((api) =>
				api.postPasskeyRegistration({
					body: sessionId.value ? { sessionId: sessionId.value } : { userId, code, codeId },
				}),
			),
		{ follow: false },
	);
	if (!registration) return;

	let credential: Record<string, unknown> | null = null;
	try {
		credential = await createWebAuthnCredential(registration.publicKeyCredentialCreationOptions);
	} catch (error) {
		console.error("Passkey registration error:", error);
	}
	if (!credential) {
		flow.error.value = "An error on registering passkey";
		return;
	}

	const verification = await flow.run(
		() =>
			useAPI((api) =>
				api.postPasskeyRegistrationVerify({
					body: {
						passkeyId: registration.passkeyId,
						passkeyName: "",
						publicKeyCredential: credential,
						sessionId: sessionId.value,
						userId,
					},
				}),
			),
		{ follow: false },
	);
	if (!verification) {
		flow.error.value ||= "Could not verify Passkey!";
		return;
	}

	await continueAndLogin(verification.loginName);
}

// a registration link carries the code: register right away (like VerifyForm)
watch(
	page,
	(loaded) => {
		if (loaded && code) submitRegisterAndContinue();
	},
	{ once: true },
);
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("set.title") }}</template>
		<template #description>{{ t("set.description") }}</template>
		<template v-if="page?.session || page?.user" #header>
			<LoginUserAvatar
				:login-name="
					page.session ? (loginName ?? page.session.factors?.user?.loginName) : page.user?.loginName
				"
				:display-name="
					page.session ? page.session.factors?.user?.displayName : page.user?.displayName
				"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<template v-else-if="page">
			<LoginAlert type="info">
				{{ t("set.info.description") }}
				<ULink
					class="text-primary hover:underline"
					target="_blank"
					to="https://zitadel.com/docs/guides/manage/user/reg-create-user#with-passwordless"
				>
					{{ t("set.info.link") }}
				</ULink>
			</LoginAlert>

			<!-- context was given but the session could not be resolved (cookie missing or expired) -->
			<div v-if="!page.session && !page.user" class="py-4">
				<LoginAlert>{{ tError(loginName || userId ? "sessionExpired" : "unknownContext") }}</LoginAlert>
			</div>

			<form v-if="sessionId || userId" class="w-full" @submit.prevent="submitRegisterAndContinue">
				<LoginFlowState :error="flow.error.value" />

				<div class="mt-8 flex w-full flex-row items-center">
					<UButton
						v-if="prompt"
						type="button"
						color="neutral"
						variant="subtle"
						@click="continueAndLogin()"
					>
						{{ t("set.skip") }}
					</UButton>
					<LoginBackButton v-else />

					<span class="grow" />
					<UButton type="submit" :loading="flow.loading.value" data-testid="submit-button">
						{{ t("set.submit") }}
					</UButton>
				</div>
			</form>
		</template>
	</LoginCard>
</template>
