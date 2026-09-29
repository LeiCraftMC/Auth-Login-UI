<script setup lang="ts">
/**
 * /u2f/set — register a security key as second factor, then check it (`checkAfter`) or finish the
 * login (Zitadel login: `u2f/set/page.tsx` + `RegisterU2f`). Only an authenticated session may
 * enroll (GHSA-45f2-5q3r-xgg6).
 */
const t = useTranslations("u2f");
const tError = useTranslations("error");
useSeoMeta({ title: () => t("set.title") });

const query = useQueryParams("loginName", "organization", "requestId", "checkAfter", "sessionId");
const { loginName, organization, requestId, checkAfter } = query;

const {
	data: page,
	error: pageError,
	loading: pageLoading,
} = await useLoginPage("u2f-set", () =>
	useAPI((api) => api.getU2fSet({ query: { loginName, organization, requestId } })),
);

const flow = useLoginFlow();
const sessionId = computed(() => page.value?.session?.id);

async function submitRegisterAndContinue() {
	const id = sessionId.value;
	if (!id) return;

	const registration = await flow.run(
		() => useAPI((api) => api.postU2fRegistration({ body: { sessionId: id } })),
		{ follow: false },
	);
	if (!registration) return;

	let credential: Record<string, unknown> | null = null;
	try {
		credential = await createWebAuthnCredential(registration.publicKeyCredentialCreationOptions);
	} catch (error) {
		console.error("U2F registration error:", error);
	}
	if (!credential) {
		flow.error.value = "An error on registering passkey";
		return;
	}

	const verified = await flow.run(
		() =>
			useAPI((api) =>
				api.postU2fRegistrationVerify({
					body: {
						u2fId: registration.u2fId,
						passkeyName: "",
						publicKeyCredential: credential,
						sessionId: id,
					},
				}),
			),
		{ follow: false },
	);
	if (verified === null) {
		flow.error.value ||= "An error on verifying passkey";
		return;
	}

	if (checkAfter === "true") {
		await navigateTo(loginPath("/u2f", { sessionId: id, loginName, organization, requestId }));
		return;
	}

	if (requestId || loginName) {
		await flow.run(() =>
			useAPI((api) =>
				api.postFlowComplete({
					body: requestId ? { sessionId: id, requestId, organization } : { loginName, organization },
				}),
			),
		);
	}
}
</script>

<template>
	<LoginCard :branding="page?.branding" :loading="pageLoading">
		<template #title>{{ t("set.title") }}</template>
		<template #description>{{ t("set.description") }}</template>
		<template v-if="page?.session" #header>
			<LoginUserAvatar
				:login-name="loginName ?? page.session.factors?.user?.loginName"
				:display-name="page.session.factors?.user?.displayName"
				show-dropdown
				:search-params="query"
			/>
		</template>

		<LoginAlert v-if="pageError">{{ pageError }}</LoginAlert>

		<template v-else-if="page">
			<!-- a loginName was given but the session could not be resolved (cookie missing or expired) -->
			<div v-if="!page.session || !page.enrollmentAuthorized" class="py-4">
				<LoginAlert>
					{{ tError(!page.session && loginName ? "sessionExpired" : "unknownContext") }}
				</LoginAlert>
			</div>

			<form
				v-if="sessionId && page.enrollmentAuthorized"
				class="w-full"
				@submit.prevent="submitRegisterAndContinue"
			>
				<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />

				<div class="mt-8 flex w-full flex-row items-center">
					<LoginBackButton />
					<span class="grow" />
					<UButton type="submit" :loading="flow.loading.value" data-testid="submit-button">
						{{ t("set.submit") }}
					</UButton>
				</div>
			</form>
		</template>
	</LoginCard>
</template>
