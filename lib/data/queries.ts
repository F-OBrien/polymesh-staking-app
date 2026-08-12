'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { DEFAULT_ERA_WINDOW } from '@/config/site';
import { chunksForRange } from './chunking';
import { prefersRollup, rollupToSeries } from './rollup-series';
import {
  fetchChunks,
  fetchLatest,
  fetchManifest,
  fetchOperators,
  fetchEraIndex,
  fetchRollup,
  fetchSlashes,
} from './client';
import { createEraIndex, type EraIndex } from './era-index';
import { pruneCache } from './cache';
import { stitchChunks, type StitchedSeries } from './series';
import type { Latest, Manifest, OperatorRegistry, Rollup, Slashes } from '@/lib/schemas/data';

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
  slashes: ['slashes'] as const,
  eraIndex: ['era-index'] as const,
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

/**
 * Offence history.
 *
 * An hour is generous for a file that can only change when an era completes,
 * but slashes are the one thing a nominator wants to see promptly, and the file
 * is a few kilobytes.
 */
export function useSlashes(enabled = true): UseQueryResult<Slashes> {
  return useQuery({
    queryKey: queryKeys.slashes,
    queryFn: ({ signal }) => fetchSlashes({ signal }),
    staleTime: 60 * MINUTE,
    enabled,
  });
}

/**
 * Era to date, over all history.
 *
 * Opt-in (`enabled`) because it is 34 KB that most pages have no use for:
 * chunks carry `eraStart` for everything they hold. This answers the same
 * question for eras outside that window — a reward paid in 2022, say.
 *
 * Immutable in practice: a past era's start never changes, and a new one is
 * appended once a day. An hour of staleness costs nothing.
 */
export function useEraIndex(enabled = true): UseQueryResult<EraIndex> {
  return useQuery({
    queryKey: queryKeys.eraIndex,
    queryFn: async ({ signal }) => createEraIndex(await fetchEraIndex({ signal })),
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
export function useEraSeries(
  requested?: Partial<EraRange>,
  /**
   * Set false to resolve the range but fetch nothing.
   *
   * `useNetworkSeries` needs this: hooks cannot be called conditionally, so the
   * chunk query is always constructed even when the rollup is serving the
   * range — and without a way to say so it would download fifty-five chunk
   * files that nothing reads.
   */
  { enabled = true }: { enabled?: boolean } = {},
): SeriesResult {
  const manifest = useManifest();
  const range = resolveRange(manifest.data, requested);

  const refs = useMemo(
    () =>
      manifest.data && range && enabled
        ? chunksForRange(manifest.data.chunks, range.fromEra, range.toEra)
        : [],
    [manifest.data, range?.fromEra, range?.toEra, enabled], // eslint-disable-line react-hooks/exhaustive-deps
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


/**
 * The network series for a range, at whatever resolution that range warrants.
 *
 * Below the threshold this is the chunk data, era by era. Above it the weekly
 * rollup, which is one small file rather than a chunk per thirty-two eras —
 * "All" over the chain's life is around fifty-five chunk files, and nobody
 * reads a five-year chart for a single era's value.
 *
 * The switch is reported, never hidden: the caller puts `resolution` in the
 * chart's coverage line, because a chart that silently changes its own
 * granularity is a chart that can be misread.
 *
 * Chunks are still fetched for a long range only if the rollup is unavailable,
 * so a missing `rollup-weekly.json` degrades to slow rather than to blank.
 */
export function useNetworkSeries(requested?: Partial<EraRange>): SeriesResult & {
  resolution: 'era' | 'week';
} {
  const manifest = useManifest();
  const range = resolveRange(manifest.data, requested);
  const wantsRollup = prefersRollup(range);

  const rollup = useRollup(wantsRollup);
  const weekly = useMemo(() => rollupToSeries(rollup.data, range), [rollup.data, range]);

  // Chunks are the fallback, so the query is only suppressed once the rollup
  // has actually produced a series — a missing or unreadable
  // `rollup-weekly.json` degrades to slow, never to blank. `useEraSeries`
  // caches by chunk hash, so stepping 90d -> All -> 90d pays for chunks once.
  const eraSeries = useEraSeries(requested, { enabled: !(wantsRollup && weekly) });

  if (wantsRollup && weekly) {
    return {
      series: weekly,
      range,
      isLoading: manifest.isLoading || rollup.isLoading,
      isFetching: manifest.isFetching || rollup.isFetching,
      isError: manifest.isError,
      error: manifest.error as Error | null,
      resolution: 'week',
    };
  }

  return { ...eraSeries, resolution: 'era' };
}
