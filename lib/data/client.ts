import { dataUrl } from '@/config/site';
import type {
  Chunk,
  ChunkRef,
  EraIndexFile,
  Latest,
  Manifest,
  Offences,
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
 * **The hash goes in the URL, and that is load-bearing.** This used to fetch
 * `chunks/1632.json` with `cache: 'force-cache'` on the reasoning that a
 * complete chunk is immutable. It is not: the archive backfill rewrote 55 of
 * them, filling in eras they had never held. `force-cache` serves a cached
 * response without revalidating *at all*, so every browser that had visited
 * before the backfill kept its old copy of that URL indefinitely — and then
 * wrote those stale bytes into IndexedDB under the *new* manifest hash, which
 * made the mistake permanent even after the HTTP entry expired.
 *
 * Reported as a gap in the charts across eras 1344–1359 and 1632–1659. Those
 * are not arbitrary: they are the halves of chunks 1344 and 1632 that had not
 * been ingested yet when those copies were cached. On disk both files are
 * complete, which is why it reproduced for one reader and for nobody else.
 *
 * Putting the content hash in the query string makes every URL genuinely
 * immutable — different content, different URL — so a stale entry can never be
 * served under a name that now means something else. `force-cache` then
 * applies to every chunk rather than only the complete ones, which also removes
 * the revalidation round trip for the trailing chunk.
 */
export async function fetchChunk(ref: ChunkRef, options?: FetchOptions): Promise<Chunk> {
  const cached = await readCachedChunk(ref.hash);
  if (cached) return cached;

  const chunk = await fetchJson(`${ref.path}?v=${ref.hash}`, 'chunk', {
    ...options,
    cache: 'force-cache',
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

/**
 * Offences reported against operators, over all history.
 *
 * Separate from `slashes.json` because the sources are different in kind: that
 * file is built from chain state, which is pruned to ~84 eras and records only
 * what was actually taken; this one is built from indexer events, which go back
 * to genesis and fire whether or not anything was taken. On a chain with
 * validator slashing switched off, this is the file with the content.
 */
export function fetchOffences(options?: FetchOptions): Promise<Offences> {
  return fetchJson('offences.json', 'offences', options);
}

/**
 * Every era's start block and time, for the chain's whole life.
 *
 * ~34 KB, and deliberately *not* fetched by default. Chunks already carry
 * `eraStart` for the eras they hold, which covers every chart axis; this is
 * only needed where a date is wanted for an era we hold no chunk for — which
 * today means reward history, and later the backfill.
 */
export function fetchEraIndex(options?: FetchOptions): Promise<EraIndexFile> {
  return fetchJson('era-index.json', 'eraIndex', options);
}
