/**
 * AppCache — Instant local memory cache & stale-while-revalidate store.
 * ─────────────────────────────────────────────────────────────────────────────
 * Keeps app launches and tab switches instant (0ms latency).
 * When user opens the app, UI renders immediately from cache while fresh data
 * synchronizes silently in the background.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();

export const AppCache = {
  get<T>(key: string): T | null {
    const entry = memoryCache.get(key);
    return entry ? entry.data : null;
  },

  set<T>(key: string, data: T): void {
    memoryCache.set(key, { data, timestamp: Date.now() });
  },

  has(key: string): boolean {
    return memoryCache.has(key);
  },

  clear(key?: string): void {
    if (key) {
      memoryCache.delete(key);
    } else {
      memoryCache.clear();
    }
  },
};
