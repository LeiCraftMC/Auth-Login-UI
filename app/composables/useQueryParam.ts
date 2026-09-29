/**
 * useQueryParam — a search parameter of the current page as a string (the first value of a
 * repeated parameter), `undefined` when absent. Pages read the Zitadel login's parameters
 * (`requestId`, `organization`, `loginName`, `sessionId`, …) through it.
 */
export function useQueryParam(name: string): string | undefined {
	const value = useRoute().query[name];
	const first = Array.isArray(value) ? value[0] : value;
	return typeof first === "string" ? first : undefined;
}

/** All given search parameters at once: `const { requestId, organization } = useQueryParams("requestId", "organization")`. */
export function useQueryParams<const K extends string>(
	...names: K[]
): Record<K, string | undefined> {
	return Object.fromEntries(names.map((name) => [name, useQueryParam(name)])) as Record<
		K,
		string | undefined
	>;
}
