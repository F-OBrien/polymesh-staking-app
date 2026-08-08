import { dataUrl } from '@/config/site';
import type {
  Chunk,
  ChunkRef,
  Latest,
  Manifest,
  OperatorRegistry,
  Rollup,
  Slashes,
} from '@/lib/schemas/data';
import { readCachedChunk, writeCachedChunk } from './cache';
import { validateData, type DataFileKind } from './validate';

/**
 * Fetching the generated data files.
 *
 * Note the schema imports here are **type-only**, so they are erased at compile
 * time. Runtime validation goes through `./validate`, which keeps Zod out of the
 * production bundle — see the note in that file for why.
 */

/** Thrown for any data-layer failure, so the UI can distinguish it from a bug. */
export class DataFetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DataFetchError';
  }
}

interface FetchOptions {
  signal?: AbortSignal;
  /** `force-cache` for immutable chunks; `no-cache` for anything time-sensitive. */
  cache?: RequestCache;
}

async function fetchJson<K extends DataFileKind>(
  path: string,
  kind: K,
  { signal, cache = 'default' }: FetchOptions = {},
) {
  const url = dataUrl(path);

  let response: Response;
  try {
    // `signal` is spread conditionally rather than passed as `undefined`:
    // RequestInit declares it `AbortSignal | null`, which under
    // exactOptionalPropertyTypes is not the same as an absent property.
    response = await fetch(url, { cache, ...(signal ? { signal } : {}) });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new DataFetchError(`Could not reach ${path}. Check your connection.`, url, { cause });
  }

  if (!response.ok) {
    throw new DataFetchError(`${path} returned ${response.status}.`, url);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new DataFetchError(`${path} is not valid JSON.`, url, { cause });
  }

  try {
    return await validateData(kind, body);
  } catch (cause) {
    throw new DataFetchError(
      `${path} does not match the expected schema. The site and its data may be out of step.`,
      url,
      { cause },
    );
  }
}

/**
 * The manifest, always fetched fresh.
 *
 * It is about a kilobyte and it is the only thing that reveals which chunks
 * exist, so caching it would strand a client on yesterday's era for as long as
 * the cache lived.
 */
export function fetchManifest(options?: FetchOptions): Promise<Manifest> {
  return fetchJson('manifest.json', 'manifest', { ...options, cache: 'no-cache' });
}

/**
 * One chunk, preferring the IndexedDB copy.
 *
 * Complete chunks are immutable, so a cache hit needs no revalidation at all.
 * The trailing incomplete chunk changes when an era lands, but its hash changes
 * with it, so a key miss handles that without any freshness logic.
 */
export async function fetchChunk(ref: ChunkRef, options?: FetchOptions): Promise<Chunk> {
  const cached = await readCachedChunk(ref.hash);
  if (cached) return cached;

  const chunk = await fetchJson(ref.path, 'chunk', {
    ...options,
    // Complete chunks are served with a long immutable max-age, so force-cache
    // lets the HTTP layer answer before we ever reach the network.
    cache: ref.complete ? 'force-cache' : 'default',
  });

  await writeCachedChunk(ref.hash, chunk);
  return chunk;
}

/**
 * Several chunks at once.
 *
 * Parallel because a 90-era window is three files and HTTP/2 handles that
 * trivially — and because after the first visit most come from IndexedDB
 * without touching the network at all.
 */
export function fetchChunks(refs: readonly ChunkRef[], options?: FetchOptions): Promise<Chunk[]> {
  return Promise.all(refs.map((ref) => fetchChunk(ref, options)));
}

/** The 15-minute snapshot. Short-lived, so never served from a stale cache. */
export function fetchLatest(options?: FetchOptions): Promise<Latest> {
  return fetchJson('latest.json', 'latest', { ...options, cache: 'no-cache' });
}

export function fetchOperators(options?: FetchOptions): Promise<OperatorRegistry> {
  return fetchJson('operators.json', 'operators', options);
}

/** Network-only weekly series, for ranges too long to load chunks for. */
export function fetchRollup(options?: FetchOptions): Promise<Rollup> {
  return fetchJson('rollup-weekly.json', 'rollup', options);
}

/**
 * Offence history.
 *
 * Rewritten wholesale by the pipeline rather than appended to, so it is not
 * hard-cached: an era leaving the chain's retention window changes
 * `prunedBefore` without changing any event.
 */
export function fetchSlashes(options?: FetchOptions): Promise<Slashes> {
  return fetchJson('slashes.json', 'slashes', options);
}
