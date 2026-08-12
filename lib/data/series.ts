import { deriveOperatorApr } from '@/lib/metrics/derive';
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

/**
 * Network columns as *stitched*, which is not the same as stored.
 *
 * A stored chunk always has a value for every era it lists, so
 * `NetworkSeriesSchema` is rightly non-nullable. A stitched range is different:
 * it can span an era no chunk covers, and that era has to carry `null` rather
 * than be dropped. See the note on the era axis below.
 */
export type StitchedNetwork = {
  [K in keyof NetworkSeries]: (number | null)[];
};

export interface StitchedSeries {
  /**
   * Every era in the range, contiguous — including ones no chunk covers.
   *
   * Contiguity is load-bearing. The axis is a *time* scale, so a skipped era
   * leaves its neighbours at their true dates and the line simply stretches
   * across the hole: no break, no marker, nothing to say a month of history is
   * missing. Filling the hole with nulls makes it a gap in every series, which
   * is what it is.
   */
  eras: number[];
  eraStart: number[];
  network: StitchedNetwork;
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
  const present = [...eraSet].sort((a, b) => a - b);

  // The axis runs over every era between the ends, not only the ones we hold.
  // See `StitchedSeries.eras`: skipping a missing era does not draw a gap, it
  // draws a line straight across it.
  const eras: number[] = [];
  const first = present[0];
  const last = present.at(-1);
  if (first != null && last != null) {
    for (let era = first; era <= last; era += 1) eras.push(era);
  }
  const indexOfEra = new Map(eras.map((era, i) => [era, i]));

  const eraStart = new Array<number>(eras.length).fill(0);
  // Which slots a chunk actually supplied. A sentinel value cannot do this job:
  // zero is a real Unix timestamp, and a test fixture starting at era 0 has a
  // genuine `eraStart` of 0 — which a zero-means-unknown check then "fills in".
  const known = new Array<boolean>(eras.length).fill(false);
  const network = Object.fromEntries(
    NETWORK_KEYS.map((key) => [key, new Array<number | null>(eras.length).fill(null)]),
  ) as unknown as StitchedNetwork;

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
      known[target] = true;
      for (const key of NETWORK_KEYS) {
        network[key][target] = chunk.network[key][sourceIndex] ?? null;
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

  // A missing era has no recorded start, and leaving it at zero would place it
  // at the epoch and drag the whole time axis back to 1970. Interpolating
  // between the eras either side keeps the axis proportional; nothing is drawn
  // at these positions anyway, since every column there is null.
  fillMissingEraStarts(eraStart, known);

  return { eras, eraStart, network, operators };
}

/** Linear interpolation across the era starts no chunk supplied. */
function fillMissingEraStarts(eraStart: number[], known: readonly boolean[]): void {
  let previous = -1;
  for (let i = 0; i < eraStart.length; i += 1) {
    if (!known[i]) continue;
    if (previous >= 0 && i - previous > 1) {
      const from = eraStart[previous] as number;
      const step = ((eraStart[i] as number) - from) / (i - previous);
      for (let k = previous + 1; k < i; k += 1) {
        eraStart[k] = Math.round(from + step * (k - previous));
      }
    }
    previous = i;
  }

  // A run of unknowns at either end has nothing to interpolate between, so it
  // extends the nearest known era by a nominal day. Only reachable when a range
  // clips outside every chunk, which the manifest should prevent.
  const DAY = 86_400;
  const firstKnown = known.indexOf(true);
  if (firstKnown > 0) {
    for (let i = firstKnown - 1; i >= 0; i -= 1) eraStart[i] = (eraStart[i + 1] as number) - DAY;
  }
  const lastKnown = known.lastIndexOf(true);
  if (lastKnown >= 0) {
    for (let i = lastKnown + 1; i < eraStart.length; i += 1) {
      eraStart[i] = (eraStart[i - 1] as number) + DAY;
    }
  }
}

/**
 * Ranking key. Raw chunk columns, plus the two derived returns — which are the
 * only rankings that actually discriminate between Polymesh operators.
 *
 * `totalStake` looks like the obvious default and is not: the election
 * equalises exposure, so the entire active set sits within a few percent of
 * each other and "the largest" is very nearly arbitrary. See
 * `docs/STATUS.md` on why the decentralisation figures look so even.
 */
export type RankKey = keyof OperatorSeries | 'aprNet' | 'aprGross';

/**
 * Operators present in the series, ordered by a metric.
 *
 * Raw columns rank on their most recent value; the derived returns rank on
 * their *mean* over the range, since a single era's return is noisy enough
 * that the top of a latest-value ranking would reshuffle daily.
 *
 * Used to pick a default selection when nothing is pinned and no wallet is
 * connected — the charts should never open empty.
 */
export function rankOperators(
  series: StitchedSeries,
  key: RankKey = 'aprNet',
  limit = 5,
  options: { erasPerYear?: number } = {},
): string[] {
  const { erasPerYear = 365 } = options;

  const latest = (values: readonly (number | null)[]): number | null => {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const value = values[i];
      if (value != null) return value;
    }
    return null;
  };

  const average = (values: readonly (number | null)[]): number | null => {
    let sum = 0;
    let count = 0;
    for (const value of values) {
      if (value != null && Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    return count === 0 ? null : sum / count;
  };

  const score = (columns: OperatorSeries): number | null => {
    if (key === 'aprNet' || key === 'aprGross') {
      const apr = deriveOperatorApr(columns, series.network, erasPerYear);
      return average(key === 'aprNet' ? apr.net : apr.gross);
    }
    return latest(columns[key]);
  };

  return Object.entries(series.operators)
    .map(([address, columns]) => ({ address, value: score(columns) }))
    .filter((entry): entry is { address: string; value: number } => entry.value != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((entry) => entry.address);
}

/** Inclusive era range actually covered, or null when the series is empty. */
export function seriesCoverage(series: StitchedSeries): { fromEra: number; toEra: number } | null {
  if (series.eras.length === 0) return null;
  return { fromEra: series.eras[0]!, toEra: series.eras.at(-1)! };
}
