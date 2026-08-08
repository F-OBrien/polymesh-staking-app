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

export async function buildRollup(
  store: RollupStore,
  chunks: readonly ChunkRef[],
): Promise<number> {
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

  return store.writeRollup(rollup);
}
