/**
 * useAPI — the single gateway to the generated API SDK.
 *
 * Configures the client via `updateAPIClient` (same-origin, cookies, the page's organization for
 * translated messages) and always returns the backend's `{ success, code, message, data }`
 * envelope (errors are normalized into the envelope, never thrown). Callers branch on
 * `result.success`. The login has no bearer token: its state lives in httpOnly cookies.
 */
import * as baseAPIClient from "@/api-client/sdk.gen";

export namespace UseAPITypes {
	export type APIClient = typeof baseAPIClient;

	export type DefaultReturn<TReturn> = TReturn;

	/** The `{ success, code, message, data }` envelope, discriminated on `success`. */
	export type Envelope<TData> =
		| { success: true; code: number; message: string; data: TData }
		| { success: false; code: number; message: string; data: null };

	/**
	 * The envelope payload of a `@hey-api/client-fetch` result: it resolves to
	 * `{ data?: <envelope>, error?: <envelope>, … }` and the envelope's `data` is the payload.
	 */
	export type EnvelopeData<W> = W extends { data: infer Env }
		? Env extends { data: infer D }
			? D
			: never
		: never;

	export type UseAPIReturnType<TReturn> = Promise<Envelope<EnvelopeData<TReturn>>>;

	export type AsyncDataReturn<TReturn> = {
		data: Ref<DefaultReturn<TReturn>>;
		loading: Ref<boolean>;
		refresh: () => Promise<void>;
	};

	export type LazyAsyncDataReturn<TReturn> = {
		data: Ref<DefaultReturn<TReturn>>;
		loading: Ref<boolean>;
		refresh: () => Promise<void>;
	};

	export type AsyncRequestTaskReturn<TReturn> = AsyncRequestTaskWrapper<TReturn>;

	export type LazyAsyncDataRequestReturn<TReturn> = LazyAsyncDataRequestWrapper<TReturn>;
}

class AsyncRequestTaskWrapper<TReturn> {
	readonly loading = ref(false);

	constructor(protected readonly handler: () => Promise<TReturn>) {}

	async execute(): Promise<TReturn> {
		this.loading.value = true;
		try {
			return await this.handler();
		} finally {
			this.loading.value = false;
		}
	}
}

class LazyAsyncDataRequestWrapper<TReturn> {
	// 1. The public read-only refs (computed)
	readonly data: Ref<TReturn | null>;
	readonly loading: Ref<boolean>;

	// 2. Internal pointers (plain class properties, NOT refs themselves)
	protected _activeDataRef: Ref<TReturn | null> | null = null;
	protected _activeLoadingRef: Ref<boolean> | null = null;

	// 3. The "signal" — determines which pointer we are looking at
	protected _linkSignal = ref(0);

	protected refreshFunction?: () => Promise<void>;
	protected clearFunction?: () => void;

	constructor(
		protected readonly name: string,
		protected readonly handler: () => Promise<TReturn>,
		immediateFNInit: boolean,
	) {
		// Initialize the computed properties ONCE
		this.data = computed({
			get: () => {
				this._linkSignal.value;
				return this._activeDataRef?.value ?? null;
			},
			set: (newValue) => {
				if (this._activeDataRef) {
					this._activeDataRef.value = newValue;
				}
			},
		});

		this.loading = computed(() => {
			this._linkSignal.value;
			return this._activeLoadingRef?.value ?? false;
		});

		if (immediateFNInit) {
			this.init();
		}
	}

	public init() {
		// Do not re-run init if already initialized to avoid replacing refs unnecessarily
		if (this.refreshFunction) return;

		const { data, refresh, clear, pending } = useLazyAsyncData<TReturn>(this.name, this.handler, {
			immediate: false,
		});

		this._activeDataRef = data as Ref<TReturn | null>;
		this._activeLoadingRef = pending;

		this.refreshFunction = refresh;
		this.clearFunction = clear;

		// Trigger the signal so the computed properties re-evaluate and find the new refs.
		this._linkSignal.value++;
	}

	async fetchData() {
		if (!this.refreshFunction) {
			this.init();
		}
		if (!this.refreshFunction) {
			throw new Error("Failed to initialize refresh function.");
		}

		await this.refreshFunction();

		return this.data;
	}

	async clearData() {
		this.clearFunction?.();
	}
}

const unwrap = (raw: any): any => raw?.data ?? raw?.error ?? raw;

export async function useAPI<TReturn>(
	handler: (api: UseAPITypes.APIClient) => Promise<TReturn>,
): UseAPITypes.UseAPIReturnType<TReturn> {
	try {
		const organization = useRoute().query.organization;
		updateAPIClient(typeof organization === "string" ? organization : undefined);

		const result = unwrap(await handler(baseAPIClient));
		if (typeof result?.success !== "boolean") {
			// not an envelope, e.g. a proxy error page
			throw new Error("An unknown error occurred.");
		}
		return result;
	} catch (error) {
		return {
			success: false,
			code: 500,
			message: (error as Error).message ?? "An unknown error occurred.",
			data: null,
		} as const;
	}
}

export async function useAPIAsyncData<TReturn>(name: string, handler: () => Promise<TReturn>) {
	const { data, pending: loading, refresh } = await useAsyncData<TReturn>(name, handler);

	return {
		data: data as Ref<TReturn>,
		loading,
		refresh,
	} satisfies UseAPITypes.AsyncDataReturn<TReturn>;
}

export async function useAPILazyAsyncData<TReturn>(name: string, handler: () => Promise<TReturn>) {
	const { data, pending: loading, refresh } = await useLazyAsyncData<TReturn>(name, handler);

	return {
		data: data as Ref<TReturn>,
		loading,
		refresh,
	} satisfies UseAPITypes.LazyAsyncDataReturn<TReturn>;
}

export function useAPIAsyncRequestTask<TReturn>(handler: () => Promise<TReturn>) {
	return new AsyncRequestTaskWrapper<TReturn>(
		handler,
	) satisfies UseAPITypes.AsyncRequestTaskReturn<TReturn>;
}

export function useAPILazyAsyncRequest<TReturn>(
	name: string,
	handler: () => Promise<TReturn>,
	immediateFNInit = false,
) {
	return new LazyAsyncDataRequestWrapper<TReturn>(
		name,
		handler,
		immediateFNInit,
	) satisfies UseAPITypes.LazyAsyncDataRequestReturn<TReturn>;
}
