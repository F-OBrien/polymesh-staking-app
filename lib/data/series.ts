import type { Chunk, NetworkSeries, OperatorSeries } from '@/lib/schemas/data';

/**
 * Stitching chunks into a single continuous series.
 *
 * Chunks are storage units, not display units: a 90-era window spans three of
 * them, and no chart should have to know that. Everything above this layer
 * works with one flat, era-indexed dataset.
 *
 * The awkward part is that operators come and go, so chunk A may hold columns
 * for an operator that chunk B does not. Naively concatenating would misalign
 * every subsequent era for that operator — the class of bug that produces a
 * chart which looks plausible and is wrong. Columns are therefore rebuilt
 * against the merged era axis, padding absent stretches with `null`.
 */

export interface StitchedSeries {
  /** Ascending, de-duplicated, gap-free within each chunk's coverage. */
  eras: number[];
  eraStart: number[];
  network: NetworkSeries;
  operators: Record<string, OperatorSeries>;
}

const NETWORK_KEYS = [
  'totalStaked',
  'totalIssuance',
  'validatorReward',
  'totalPoints',
  'activeOperators',
  'nominatorCount',
  'avgCommission',
  'avgApr',
  'aprP10',
  'aprP50',
  'aprP90',
] as const satisfies readonly (keyof NetworkSeries)[];

const OPERATOR_KEYS = [
  'points',
  'commission',
  'totalStake',
  'ownStake',
  'nominatorCount',
] as const satisfies readonly (keyof OperatorSeries)[];

/**
 * Merges chunks into one series, optionally clipped to an era range.
 *
 * Later chunks win on overlap, which matters when a re-fetched trailing chunk
 * is stitched alongside a cached copy of itself.
 */
export function stitchChunks(
  chunks: readonly Chunk[],
  range?: { fromEra: number; toEra: number },
): StitchedSeries {
  // Collect every era once, in order.
  const eraSet = new Set<number>();
  for (const chunk of chunks) {
    for (const era of chunk.eras) {
      if (range && (era < range.fromEra || era > range.toEra)) continue;
      eraSet.add(era);
    }
  }
  const eras = [...eraSet].sort((a, b) => a - b);
  const indexOfEra = new Map(eras.map((era, i) => [era, i]));

  const eraStart = new Array<number>(eras.length).fill(0);
  const network = Object.fromEntries(
    NETWORK_KEYS.map((key) => [key, new Array<number>(eras.length).fill(0)]),
  ) as unknown as NetworkSeries;

  const addresses = new Set<string>();
  for (const chunk of chunks) {
    for (const address of Object.keys(chunk.operators)) addresses.add(address);
  }

  const operators: Record<string, OperatorSeries> = {};
  for (const address of addresses) {
    operators[address] = Object.fromEntries(
      OPERATOR_KEYS.map((key) => [key, new Array<number | null>(eras.length).fill(null)]),
    ) as unknown as OperatorSeries;
  }

  for (const chunk of chunks) {
    for (const [sourceIndex, era] of chunk.eras.entries()) {
      const target = indexOfEra.get(era);
      if (target == null) continue; // outside the requested range

      eraStart[target] = chunk.eraStart[sourceIndex] ?? 0;
      for (const key of NETWORK_KEYS) {
        network[key][target] = chunk.network[key][sourceIndex] ?? 0;
      }

      for (const address of addresses) {
        const source = chunk.operators[address];
        if (!source) continue; // operator absent from this chunk: stays null
        for (const key of OPERATOR_KEYS) {
          operators[address]![key][target] = source[key][sourceIndex] ?? null;
        }
      }
    }
  }

  return { eras, eraStart, network, operators };
}

/**
 * Operators present in the series, ordered by a column's most recent value.
 *
 * Used to pick sensible default selections — the largest operators by stake —
 * when the user has no wallet connected and nothing pinned.
 */
export function rankOperators(
  series: StitchedSeries,
  column: keyof OperatorSeries = 'totalStake',
  limit = 5,
): string[] {
  const latest = (values: readonly (number | null)[]): number => {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const value = values[i];
      if (value != null) return value;
    }
    return -1;
  };

  return Object.entries(series.operators)
    .map(([address, columns]) => ({ address, value: latest(columns[column]) }))
    .filter((entry) => entry.value >= 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((entry) => entry.address);
}

/** Inclusive era range actually covered, or null when the series is empty. */
export function seriesCoverage(series: StitchedSeries): { fromEra: number; toEra: number } | null {
  if (series.eras.length === 0) return null;
  return { fromEra: series.eras[0]!, toEra: series.eras.at(-1)! };
}
