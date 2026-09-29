/**
 * useLoginPage — loads the data of a login page from its `GET` endpoint without blocking the
 * navigation (the card shows a skeleton meanwhile). A failed request becomes `error` (the
 * Zitadel login renders such page errors as an alert inside the card).
 */
type PageResult<T> = { success: true; data: T } | { success: false; message: string };

export async function useLoginPage<T>(key: string, request: () => Promise<PageResult<T>>) {
	const route = useRoute();
	const { data: result, loading } = await useAPILazyAsyncData(`${key}:${route.fullPath}`, request);

	const data = computed(() => (result.value?.success ? result.value.data : null));
	const error = computed(() => (result.value && !result.value.success ? result.value.message : ""));

	return { data, error, loading };
}
