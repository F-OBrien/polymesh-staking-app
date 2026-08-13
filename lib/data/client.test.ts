import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchChunk } from './client';
import type { Chunk, ChunkRef } from '@/lib/schemas/data';

/**
 * That a chunk request can never be answered by a stale copy of a different
 * chunk.
 *
 * This is the bug that produced a month-wide hole in the charts for one reader
 * and for nobody else: `chunks/1632.json` was requested with `force-cache`, the
 * backfill rewrote that file, and the browser kept serving what it already had.
 * The manifest hash had changed and nothing consulted it, so the only defence
 * is that the URL itself changes.
 */

vi.mock('./cache', () => ({
  readCachedChunk: vi.fn(async () => null),
  writeCachedChunk: vi.fn(async () => undefined),
  isCacheAvailable: () => false,
  pruneCache: vi.fn(async () => 0),
}));

const chunk: Chunk = {
  from: 1632,
  to: 1663,
  eras: [1632],
  eraStart: [1_776_259_572],
  network: {
    totalStaked: [1],
    totalIssuance: [2],
    validatorReward: [1],
    totalPoints: [100],
    activeOperators: [1],
    nominatorCount: [1],
    avgCommission: [0.1],
    avgApr: [0.2],
    aprP10: [0.1],
    aprP50: [0.2],
    aprP90: [0.3],
  },
  operators: {},
  provenance: {
    specVersion: [7_004_001],
    exposureShape: ['clipped'],
    source: ['backfill-archive'],
  },
} as unknown as Chunk;

const ref: ChunkRef = {
  from: 1632,
  to: 1663,
  path: 'chunks/1632.json',
  hash: 'dc7fbf5952a11178',
  complete: true,
};

describe('fetchChunk', () => {
  let calls: { url: string; init: RequestInit }[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(chunk), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
  });

  it('versions the URL by content hash', async () => {
    await fetchChunk(ref);
    expect(calls[0]!.url).toContain('chunks/1632.json');
    expect(calls[0]!.url).toContain(`v=${ref.hash}`);
  });

  it('gives a rewritten chunk a different URL from the one it replaced', async () => {
    // The whole point. Same path, new content, new hash — so a cached response
    // for the old URL is unreachable rather than merely unpreferred.
    await fetchChunk(ref);
    await fetchChunk({ ...ref, hash: 'ffffffffffffffff' });
    expect(calls[0]!.url).not.toBe(calls[1]!.url);
  });

  it('force-caches an incomplete chunk too, now that its URL is immutable', async () => {
    // Previously `default`, which cost a revalidation round trip on the
    // trailing chunk every time. A hash-versioned URL cannot go stale, so the
    // distinction is gone.
    await fetchChunk({ ...ref, complete: false });
    expect(calls[0]!.init.cache).toBe('force-cache');
  });
});
