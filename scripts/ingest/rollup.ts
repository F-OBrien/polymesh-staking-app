/**
 * Weekly network rollup.
 *
 * Long-range overview charts read this instead of chunks. At ~1,700 eras the
 * full chunk set is around 2 MB, which cannot go on a page load just to draw a
 * five-year staking-ratio line; this holds network metrics only — no
 * per-operator columns — so it stays under a hundred kilobytes for all of
 * history (design doc §6.5a).
 *
 * Rebuilt from scratch on every run. It is small, and deriving it from the
 * chunks on disk guarantees it can never disagree with them.
 */

import type { ChunkRef, Rollup } from '../../lib/schemas/data';
import type { DataStore } from './store';

/** Seven eras per bucket: an era is 24 hours, so a bucket is a week. */
const ERAS_PER_BUCKET = 7;

const round = (value: number, dp: number): number => Number(value.toFixed(dp));

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

interface EraRow {
  era: number;
  eraStart: number;
  totalStaked: number;
  totalIssuance: number;
  validatorReward: number;
  totalPoints: number;
  avgApr: number;
  activeOperators: number;
}

/**
 * Narrowed store dependency: only what the rollup actually needs. Keeps this
 * unit-testable without standing up a filesystem.
 */
export type RollupStore = Pick<DataStore, 'readChunk' | 'writeRollup'>;

export interface RollupResult {
  bytes: number;
  /**
   * The **contiguous** era span stored on disk, starting at the oldest era we
   * hold, or null when there is none.
   *
   * The manifest's `firstEra`/`lastCompleteEra` are taken from this rather than
   * from the chain's current era, because they are the incremental cursor:
   * recording an era we have not actually stored makes the next run believe it
   * is up to date and silently skip everything in between.
   *
   * Contiguity matters as much as the endpoints. A min/max span cannot see an
   * interior gap, so a run that stored eras 1663-1668 and 1746 would report
   * "1663-1746" and permanently strand the 77 eras between. Stopping at the
   * first gap makes the next run re-fetch from there, so a partial or
   * interrupted ingest heals itself instead of silently losing history.
   */
  coverage: { firstEra: number; lastEra: number } | null;
  /** Eras missing inside the stored span, for reporting. */
  gaps: { from: number; to: number }[];
}

export async function buildRollup(
  store: RollupStore,
  chunks: readonly ChunkRef[],
): Promise<RollupResult> {
  const rows: EraRow[] = [];

  for (const ref of [...chunks].sort((a, b) => a.from - b.from)) {
    const chunk = await store.readChunk(ref.from);
    if (!chunk) continue;

    for (const [i, era] of chunk.eras.entries()) {
      rows.push({
        era,
        eraStart: chunk.eraStart[i] ?? 0,
        totalStaked: chunk.network.totalStaked[i] ?? 0,
        totalIssuance: chunk.network.totalIssuance[i] ?? 0,
        validatorReward: chunk.network.validatorReward[i] ?? 0,
        totalPoints: chunk.network.totalPoints[i] ?? 0,
        avgApr: chunk.network.avgApr[i] ?? 0,
        activeOperators: chunk.network.activeOperators[i] ?? 0,
      });
    }
  }

  rows.sort((a, b) => a.era - b.era);

  const buckets: EraRow[][] = [];
  for (let i = 0; i < rows.length; i += ERAS_PER_BUCKET) {
    buckets.push(rows.slice(i, i + ERAS_PER_BUCKET));
  }

  const rollup: Rollup = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    weekStart: buckets.map((b) => b[0]!.eraStart),
    eraFrom: buckets.map((b) => b[0]!.era),
    eraTo: buckets.map((b) => b.at(-1)!.era),
    // Stocks (a balance at a point in time) are averaged; flows (an amount paid
    // over a period) are summed. Averaging a reward would understate the week
    // sevenfold and is an easy mistake to make here.
    totalStaked: buckets.map((b) => Math.round(mean(b.map((r) => r.totalStaked)))),
    totalIssuance: buckets.map((b) => Math.round(mean(b.map((r) => r.totalIssuance)))),
    validatorReward: buckets.map((b) =>
      round(
        b.reduce((sum, r) => sum + r.validatorReward, 0),
        3,
      ),
    ),
    totalPoints: buckets.map((b) => Math.round(mean(b.map((r) => r.totalPoints)))),
    avgApr: buckets.map((b) => round(mean(b.map((r) => r.avgApr)), 5)),
    activeOperators: buckets.map((b) => Math.round(mean(b.map((r) => r.activeOperators)))),
  };

  const bytes = await store.writeRollup(rollup);

  return { bytes, ...analyseCoverage(rows.map((r) => r.era)) };
}

/**
 * Finds the contiguous run from the oldest stored era, and any gaps after it.
 * `eras` must be ascending; duplicates are tolerated.
 */
export function analyseCoverage(eras: readonly number[]): Pick<RollupResult, 'coverage' | 'gaps'> {
  if (eras.length === 0) return { coverage: null, gaps: [] };

  const unique = [...new Set(eras)].sort((a, b) => a - b);
  const firstEra = unique[0]!;

  let contiguousEnd = firstEra;
  const gaps: { from: number; to: number }[] = [];

  for (let i = 1; i < unique.length; i += 1) {
    const previous = unique[i - 1]!;
    const current = unique[i]!;
    if (current === previous + 1) {
      if (gaps.length === 0) contiguousEnd = current;
    } else {
      gaps.push({ from: previous + 1, to: current - 1 });
    }
  }

  return { coverage: { firstEra, lastEra: contiguousEnd }, gaps };
}
