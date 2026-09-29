<script setup lang="ts">
/**
 * WebAuthn login with a passkey (or, with `login: false`, a security key as second factor):
 * requests the challenge on the session, asks the browser for the assertion and verifies it
 * (Zitadel login: `LoginPasskey`). Starts once on mount; the button retries.
 */
const props = withDefaults(
	defineProps<{
		loginName?: string;
		sessionId?: string;
		requestId?: string;
		/** Offer the password instead of the back button. */
		altPassword?: boolean;
		organization?: string;
		/** false = second factor: user verification is discouraged instead of required. */
		login?: boolean;
	}>(),
	{ login: true },
);

const t = useTranslations("passkey");
const flow = useLoginFlow();

async function requestChallenge() {
	const response = await flow.run(
		() =>
			useAPI((api) =>
				api.postSession({
					body: {
						loginName: props.loginName,
						sessionId: props.sessionId,
						organization: props.organization,
						requestId: props.requestId,
						challenges: {
							webAuthN: {
								userVerificationRequirement: props.login ? "required" : "discouraged",
							},
						},
					},
				}),
			),
		{ follow: false },
	);
	return response?.challenges?.webAuthN?.publicKeyCredentialRequestOptions?.publicKey as
		| Record<string, unknown>
		| undefined;
}

async function submitLogin(credentialAssertionData: Record<string, unknown>) {
	const response = await flow.run(() =>
		useAPI((api) =>
			api.postPasskey({
				body: {
					loginName: props.loginName,
					sessionId: props.sessionId,
					organization: props.organization,
					requestId: props.requestId,
					credentialAssertionData,
				},
			}),
		),
	);
	if (response && !response.redirect && !response.samlData) {
		flow.error.value = t("verify.errors.noRedirectProvided");
	}
}

async function start() {
	flow.error.value = "";
	const publicKey = await requestChallenge();
	if (!publicKey) {
		if (!flow.error.value) flow.error.value = t("verify.errors.couldNotRequestChallenge");
		return;
	}

	flow.loading.value = true;
	let assertion: Record<string, unknown> | null;
	try {
		assertion = await getWebAuthnAssertion(publicKey);
	} catch (error) {
		flow.loading.value = false;
		flow.error.value =
			(error as Error)?.name === "NotAllowedError"
				? t("verify.errors.verificationCancelled")
				: t("verify.errors.verificationFailed");
		console.error("Passkey verification error:", error);
		return;
	}
	flow.loading.value = false;

	if (!assertion) {
		flow.error.value = t("verify.errors.couldNotRetrievePasskey");
		return;
	}
	await submitLogin(assertion);
}

const passwordLink = computed(() =>
	// the password is requested as alternative, so the passkey prompt can be escaped
	loginPath("/password", {
		loginName: props.loginName,
		sessionId: props.sessionId,
		requestId: props.requestId,
		organization: props.organization,
	}),
);

onMounted(() => {
	start();
});
</script>

<template>
	<div class="w-full">
		<LoginFlowState :error="flow.error.value" :saml-data="flow.samlData.value" />

		<div class="mt-8 flex w-full flex-row items-center">
			<UButton
				v-if="altPassword"
				:to="passwordLink"
				color="neutral"
				variant="subtle"
				data-testid="password-button"
			>
				{{ t("verify.usePassword") }}
			</UButton>
			<LoginBackButton v-else />

			<span class="grow" />
			<UButton
				type="button"
				:loading="flow.loading.value"
				data-testid="submit-button"
				@click="start"
			>
				{{ t("verify.submit") }}
			</UButton>
		</div>
	</div>
</template>
