import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Chunk } from '@/lib/schemas/data';

/**
 * IndexedDB cache for era chunks.
 *
 * Completed chunks are immutable forever, so a returning visitor with no new
 * era should do zero data fetching beyond the manifest. HTTP caching alone
 * cannot promise that — caches get evicted, and a hard reload bypasses them,
 * which is precisely how the previous app ended up re-downloading frozen
 * history on every visit.
 *
 * Keyed by **content hash**, not by era range. A chunk whose content changed
 * gets a new key, so a stale entry can never be served under a fresh name, and
 * the incomplete trailing chunk naturally supersedes itself each time an era
 * lands.
 */

const STORE_NAME = 'chunks';
const DB_NAME = 'polymesh-staking';

/**
 * Bumped when previously-stored entries can no longer be trusted.
 *
 * Content hashing makes a key mean "this exact chunk", so a stale entry is
 * normally impossible. It became possible anyway: `fetchChunk` requested an
 * unversioned URL with `cache: 'force-cache'`, so after the backfill rewrote a
 * chunk the browser's HTTP cache handed back the old bytes, and this store then
 * recorded them under the *new* hash. From that point the key was a lie, and no
 * amount of correct fetching could dislodge it — the read below hits first.
 *
 * The URL now carries the hash, so it cannot recur. Readers already holding a
 * poisoned entry need it abandoned, and a prefix does that in one line without
 * an upgrade path or a migration: the old keys no longer match anything and
 * `pruneCache` collects them on the next visit.
 */
const CACHE_EPOCH = 'v2';

/** Namespaced key for a chunk's content hash. See `CACHE_EPOCH`. */
function cacheKey(hash: string): string {
  return `${CACHE_EPOCH}:${hash}`;
}

/** Lazily created: touching indexedDB at module scope breaks SSR and prerender. */
let store: ReturnType<typeof createStore> | null = null;

function getStore() {
  store ??= createStore(DB_NAME, STORE_NAME);
  return store;
}

/** IndexedDB is absent in Node and blocked in some privacy modes. */
export function isCacheAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function readCachedChunk(hash: string): Promise<Chunk | null> {
  if (!isCacheAvailable()) return null;
  try {
    return (await get<Chunk>(cacheKey(hash), getStore())) ?? null;
  } catch {
    // A cache miss and a broken cache are the same thing to the caller: fetch.
    return null;
  }
}

export async function writeCachedChunk(hash: string, chunk: Chunk): Promise<void> {
  if (!isCacheAvailable()) return;
  try {
    await set(cacheKey(hash), chunk, getStore());
  } catch {
    // Quota exceeded, private mode, etc. Caching is an optimisation, never a
    // requirement — failing here must not break the page.
  }
}

/**
 * Drops cached chunks whose hash is no longer referenced by the manifest.
 *
 * Without this the store grows without bound: every re-write of the trailing
 * chunk mints a new hash and orphans the previous one, so an active user would
 * accumulate one dead entry per era indefinitely.
 *
 * It is also what collects entries from a previous `CACHE_EPOCH`: they carry a
 * prefix no live hash can produce, so they fall out here on the first visit
 * after the bump.
 */
export async function pruneCache(liveHashes: ReadonlySet<string>): Promise<number> {
  if (!isCacheAvailable()) return 0;
  try {
    const live = new Set([...liveHashes].map(cacheKey));
    const stored = await keys(getStore());
    const stale = stored.filter((key): key is string => typeof key === 'string' && !live.has(key));
    await Promise.all(stale.map((key) => del(key, getStore())));
    return stale.length;
  } catch {
    return 0;
  }
}
