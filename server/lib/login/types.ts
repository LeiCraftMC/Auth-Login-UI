/** Auto-submitted form post (SAML POST binding, form-data IdP flows). */
export type SamlData = { url: string; fields: Record<string, string> };

/**
 * What a login step returns: where to go next, a POST form to submit, or a user-facing error
 * (the Zitadel login's server-action response shape).
 */
export type FlowResult = { redirect: string } | { error: string } | { samlData: SamlData };

export function isFlowResult(value: unknown): value is FlowResult {
	return (
		!!value &&
		typeof value === "object" &&
		(("redirect" in value && typeof (value as any).redirect === "string") ||
			("error" in value && typeof (value as any).error === "string") ||
			("samlData" in value && !!(value as any).samlData))
	);
}

/** Placeholder user id used instead of a real one while enumeration protection applies. */
export const UNKNOWN_USER_ID = "000000000000000000";
