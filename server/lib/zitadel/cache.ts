/**
 * A bounded, stale-while-revalidate in-memory promise cache (the Zitadel login's `PromiseCache`,
 * implemented without lru-cache):
 *
 * - LRU eviction, bounded to `maxSize` entries
 * - concurrent requests for the same key share one in-flight promise
 * - an expired entry is served immediately while it is refreshed in the background
 * - a failed refresh keeps the stale value; a failed first fetch is not cached
 */
type Entry<T> = {
	value?: T;
	hasValue: boolean;
	expiresAt: number;
	inflight?: Promise<T>;
};

export class PromiseCache {
	private readonly entries = new Map<string, Entry<any>>();

	constructor(
		private readonly maxSize = 100,
		private readonly now: () => number = Date.now,
	) {}

	getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
		const entry = this.entries.get(key) as Entry<T> | undefined;

		if (entry) {
			// refresh LRU position
			this.entries.delete(key);
			this.entries.set(key, entry);

			if (entry.hasValue && entry.expiresAt > this.now()) {
				return Promise.resolve(entry.value as T);
			}
			if (entry.hasValue) {
				this.refresh(key, entry, fetcher, ttlMs).catch(() => undefined);
				return Promise.resolve(entry.value as T);
			}
			if (entry.inflight) {
				return entry.inflight;
			}
		}

		const fresh: Entry<T> = { hasValue: false, expiresAt: 0 };
		this.entries.set(key, fresh);
		this.evict();
		return this.refresh(key, fresh, fetcher, ttlMs);
	}

	private refresh<T>(key: string, entry: Entry<T>, fetcher: () => Promise<T>, ttlMs: number) {
		if (entry.inflight) return entry.inflight;

		entry.inflight = fetcher()
			.then((value) => {
				entry.value = value;
				entry.hasValue = true;
				entry.expiresAt = this.now() + ttlMs;
				return value;
			})
			.catch((error) => {
				if (!entry.hasValue && this.entries.get(key) === entry) {
					this.entries.delete(key);
				}
				throw error;
			})
			.finally(() => {
				entry.inflight = undefined;
			});

		return entry.inflight;
	}

	private evict() {
		while (this.entries.size > Math.max(1, this.maxSize)) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}

	get size(): number {
		return this.entries.size;
	}

	clear(): void {
		this.entries.clear();
	}
}
