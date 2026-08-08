'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { DEFAULT_ERA_WINDOW } from '@/config/site';
import { chunksForRange } from './chunking';
import { fetchChunks, fetchLatest, fetchManifest, fetchOperators, fetchRollup } from './client';
import { pruneCache } from './cache';
import { stitchChunks, type StitchedSeries } from './series';
import type { Latest, Manifest, OperatorRegistry, Rollup } from '@/lib/schemas/data';

/**
 * Query hooks over the generated data.
 *
 * The staleness policy is the whole point, so it is stated explicitly per
 * query rather than left to defaults:
 *
 *  - **Chunks: `staleTime: Infinity`.** Immutable by construction. The previous
 *    app left `staleTime` at 0 and so re-fetched frozen history on every mount.
 *  - **Manifest: one minute.** It is the only thing that reveals a new era.
 *  - **Latest: one minute.** Regenerated every fifteen; polling faster is waste.
 *  - **Operators: one hour.** Names change roughly never.
 */

export const queryKeys = {
  manifest: ['manifest'] as const,
  operators: ['operators'] as const,
  latest: ['latest'] as const,
  rollup: ['rollup'] as const,
  chunks: (hashes: readonly string[]) => ['chunks', ...hashes] as const,
};

const MINUTE = 60_000;

export function useManifest(): UseQueryResult<Manifest> {
  return useQuery({
    queryKey: queryKeys.manifest,
    queryFn: ({ signal }) => fetchManifest({ signal }),
    staleTime: MINUTE,
    // A new era every 24h; hourly is ample and costs one kilobyte.
    refetchInterval: 60 * MINUTE,
  });
}

export function useOperators(): UseQueryResult<OperatorRegistry> {
  return useQuery({
    queryKey: queryKeys.operators,
    queryFn: ({ signal }) => fetchOperators({ signal }),
    staleTime: 60 * MINUTE,
  });
}

/**
 * The active-era snapshot.
 *
 * Everything derived from it — era progress, countdowns — is computed in the
 * browser from its anchors, so this does not need to be polled aggressively to
 * keep a countdown moving (design doc §6.6a).
 */
export function useLatest(): UseQueryResult<Latest> {
  return useQuery({
    queryKey: queryKeys.latest,
    queryFn: ({ signal }) => fetchLatest({ signal }),
    staleTime: MINUTE,
    refetchInterval: 5 * MINUTE,
  });
}

export function useRollup(enabled = true): UseQueryResult<Rollup> {
  return useQuery({
    queryKey: queryKeys.rollup,
    queryFn: ({ signal }) => fetchRollup({ signal }),
    staleTime: 60 * MINUTE,
    enabled,
  });
}

export interface EraRange {
  fromEra: number;
  toEra: number;
}

/**
 * Resolves an era range against the manifest.
 *
 * Passing `undefined` selects the most recent `DEFAULT_ERA_WINDOW` eras. The
 * result is clamped to what actually exists, so a range extending past ingested
 * history yields the available subset rather than an error — coverage is
 * reported separately, in the UI, rather than failing the query.
 */
export function resolveRange(manifest: Manifest | undefined, requested?: Partial<EraRange>): EraRange | null {
  if (!manifest) return null;

  const toEra = Math.min(requested?.toEra ?? manifest.lastCompleteEra, manifest.lastCompleteEra);
  const fromEra = Math.max(
    requested?.fromEra ?? toEra - DEFAULT_ERA_WINDOW + 1,
    manifest.firstEra,
  );

  return fromEra > toEra ? null : { fromEra, toEra };
}

export interface SeriesResult {
  series: StitchedSeries | null;
  range: EraRange | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  /** True while widening a range pulls in chunks not yet cached. */
  isFetching: boolean;
}

/**
 * Loads exactly the chunks a range needs, and stitches them.
 *
 * This is what keeps the default view cheap at ~1,700 eras of history: the
 * manifest lists each chunk's span, so a 90-era window resolves to three files
 * (design doc §6.5a). Widening the range fetches only the chunks not already
 * held.
 *
 * Keyed by chunk hash, so the cache entry for a range is shared with any other
 * range covering the same chunks.
 */
export function useEraSeries(requested?: Partial<EraRange>): SeriesResult {
  const manifest = useManifest();
  const range = resolveRange(manifest.data, requested);

  const refs = useMemo(
    () =>
      manifest.data && range
        ? chunksForRange(manifest.data.chunks, range.fromEra, range.toEra)
        : [],
    [manifest.data, range?.fromEra, range?.toEra], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const chunks = useQuery({
    queryKey: queryKeys.chunks(refs.map((r) => r.hash)),
    queryFn: async ({ signal }) => {
      const loaded = await fetchChunks(refs, { signal });
      // Opportunistic housekeeping: drop cache entries the manifest no longer
      // references, so the store does not grow by one dead chunk per era.
      void pruneCache(new Set(manifest.data?.chunks.map((c) => c.hash) ?? []));
      return loaded;
    },
    enabled: refs.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const series = useMemo(
    () => (chunks.data && range ? stitchChunks(chunks.data, range) : null),
    [chunks.data, range?.fromEra, range?.toEra], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    series,
    range,
    isLoading: manifest.isLoading || (refs.length > 0 && chunks.isLoading),
    isFetching: manifest.isFetching || chunks.isFetching,
    isError: manifest.isError || chunks.isError,
    error: (manifest.error ?? chunks.error) as Error | null,
  };
}
