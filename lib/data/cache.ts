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
    return (await get<Chunk>(hash, getStore())) ?? null;
  } catch {
    // A cache miss and a broken cache are the same thing to the caller: fetch.
    return null;
  }
}

export async function writeCachedChunk(hash: string, chunk: Chunk): Promise<void> {
  if (!isCacheAvailable()) return;
  try {
    await set(hash, chunk, getStore());
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
 */
export async function pruneCache(liveHashes: ReadonlySet<string>): Promise<number> {
  if (!isCacheAvailable()) return 0;
  try {
    const stored = await keys(getStore());
    const stale = stored.filter((key): key is string => typeof key === 'string' && !liveHashes.has(key));
    await Promise.all(stale.map((key) => del(key, getStore())));
    return stale.length;
  } catch {
    return 0;
  }
}
