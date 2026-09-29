/**
 * WebAuthn helpers (Zitadel login: `helpers/base64.ts` + the passkey / U2F components). Zitadel
 * sends the credential options as JSON with base64url-encoded binary fields and expects the
 * browser's response back in the same encoding.
 */
type JsonObject = Record<string, any>;

export function coerceToBase64Url(thing: unknown, name: string): string {
	let value = thing;
	if (Array.isArray(value)) value = Uint8Array.from(value);
	if (value instanceof ArrayBuffer) value = new Uint8Array(value);

	if (value instanceof Uint8Array) {
		let str = "";
		for (let i = 0; i < value.byteLength; i++) {
			str += String.fromCharCode(value[i] as number);
		}
		value = window.btoa(str);
	}

	if (typeof value !== "string") {
		throw new Error(`could not coerce '${name}' to string`);
	}

	// base64 to base64url; the "=" padding is optional
	return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=*$/g, "");
}

export function coerceToArrayBuffer(thing: unknown, name: string): ArrayBuffer {
	let value = thing;
	if (typeof value === "string") {
		const str = window.atob(value.replace(/-/g, "+").replace(/_/g, "/"));
		const bytes = new Uint8Array(str.length);
		for (let i = 0; i < str.length; i++) {
			bytes[i] = str.charCodeAt(i);
		}
		value = bytes;
	}

	if (Array.isArray(value)) value = new Uint8Array(value);
	if (value instanceof Uint8Array) {
		value = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
	}

	if (!(value instanceof ArrayBuffer)) {
		throw new TypeError(`could not coerce '${name}' to ArrayBuffer`);
	}
	return value;
}

/** `navigator.credentials.get` for a passkey / security key login; returns the assertion as JSON. */
export async function getWebAuthnAssertion(publicKey: JsonObject): Promise<JsonObject | null> {
	const options = { ...publicKey };
	options.challenge = coerceToArrayBuffer(options.challenge, "publicKey.challenge");
	options.allowCredentials = (options.allowCredentials ?? []).map((item: JsonObject) => ({
		...item,
		id: coerceToArrayBuffer(item.id, "publicKey.allowCredentials.id"),
	}));

	const assertedCredential = (await navigator.credentials.get({
		publicKey: options as PublicKeyCredentialRequestOptions,
	})) as PublicKeyCredential | null;
	if (!assertedCredential) return null;

	const response = assertedCredential.response as AuthenticatorAssertionResponse;
	return {
		id: assertedCredential.id,
		rawId: coerceToBase64Url(assertedCredential.rawId, "rawId"),
		type: assertedCredential.type,
		response: {
			authenticatorData: coerceToBase64Url(response.authenticatorData, "authData"),
			clientDataJSON: coerceToBase64Url(response.clientDataJSON, "clientDataJSON"),
			signature: coerceToBase64Url(response.signature, "sig"),
			// empty for security keys without a user handle (as the Zitadel login sends it)
			userHandle: coerceToBase64Url(response.userHandle ?? new ArrayBuffer(0), "userHandle"),
		},
	};
}

/** `navigator.credentials.create` for a passkey / security key registration. */
export async function createWebAuthnCredential(
	publicKeyCredentialCreationOptions: JsonObject,
): Promise<JsonObject | null> {
	const options = { ...(publicKeyCredentialCreationOptions.publicKey ?? {}) };
	options.challenge = coerceToArrayBuffer(options.challenge, "challenge");
	options.user = {
		...options.user,
		id: coerceToArrayBuffer(options.user?.id, "userid"),
	};
	if (options.excludeCredentials) {
		options.excludeCredentials = options.excludeCredentials.map((cred: JsonObject) => ({
			...cred,
			id: coerceToArrayBuffer(cred.id as string, "excludeCredentials.id"),
		}));
	}

	const credential = (await navigator.credentials.create({
		publicKey: options as PublicKeyCredentialCreationOptions,
	})) as PublicKeyCredential | null;
	if (!credential?.type || !credential.rawId || !credential.response) return null;

	const response = credential.response as AuthenticatorAttestationResponse;
	if (!response.attestationObject || !response.clientDataJSON) return null;

	return {
		id: credential.id,
		rawId: coerceToBase64Url(credential.rawId, "rawId"),
		type: credential.type,
		response: {
			attestationObject: coerceToBase64Url(response.attestationObject, "attestationObject"),
			clientDataJSON: coerceToBase64Url(response.clientDataJSON, "clientDataJSON"),
		},
	};
}
