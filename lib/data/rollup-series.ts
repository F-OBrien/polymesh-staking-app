import type { NetworkSeries, Rollup } from '@/lib/schemas/data';
import type { StitchedSeries } from './series';

/**
 * The weekly rollup, in the shape the charts already take.
 *
 * `rollup-weekly.json` was built in Phase 1c for exactly this and then never
 * consumed — `useRollup` existed with no caller, and every range went to the
 * chunks. That was invisible while the site held 84 eras. Once the archive
 * backfill landed the chain's whole life it stopped being invisible: "All" is
 * around fifty-five chunk files, and the rollup is one file of a few tens of
 * kilobytes covering the same span.
 *
 * The adapter is a shape change, not a computation. Everything here is already
 * aggregated by `scripts/ingest/rollup.ts` from the chunks on disk, so a
 * weekly chart and a daily one over the same span cannot disagree — they are
 * the same numbers at two resolutions.
 *
 * **Network only.** The rollup has no per-operator columns and should not: the
 * point is to answer "what has the network done over five years" without
 * loading a hundred operators × 1,749 eras. Operator comparison stays on the
 * chunks, and the range control caps it accordingly.
 */

/** Weeks, not eras — the caller must label the axis accordingly. */
export interface RollupSeries extends StitchedSeries {
  /** Always `week` here. Charts state resolution rather than implying it. */
  resolution: 'week';
}

/**
 * Buckets whose era span overlaps `[fromEra, toEra]`, as a `StitchedSeries`.
 *
 * Returns null when the rollup is absent or the range selects nothing, so a
 * caller falls back to chunks rather than drawing an empty chart.
 */
export function rollupToSeries(
  rollup: Rollup | undefined,
  range: { fromEra: number; toEra: number } | null | undefined,
): RollupSeries | null {
  if (!rollup || !range) return null;

  const keep: number[] = [];
  for (let i = 0; i < rollup.eraFrom.length; i += 1) {
    const from = rollup.eraFrom[i] as number;
    const to = rollup.eraTo[i] as number;
    // Overlap, not containment: the range's endpoints almost never align with
    // week boundaries, and dropping a partly-covered bucket would lop a week
    // off each end of every chart.
    if (to >= range.fromEra && from <= range.toEra) keep.push(i);
  }
  if (keep.length === 0) return null;

  const pick = (column: readonly number[]): number[] => keep.map((i) => column[i] as number);

  const network: NetworkSeries = {
    totalStaked: pick(rollup.totalStaked),
    totalIssuance: pick(rollup.totalIssuance),
    validatorReward: pick(rollup.validatorReward),
    totalPoints: pick(rollup.totalPoints),
    activeOperators: pick(rollup.activeOperators),
    nominatorCount: pick(rollup.nominatorCount),
    avgCommission: pick(rollup.avgCommission),
    avgApr: pick(rollup.avgApr),
    aprP10: pick(rollup.aprP10),
    aprP50: pick(rollup.aprP50),
    aprP90: pick(rollup.aprP90),
  };

  return {
    // The bucket's *last* era identifies it, matching how a weekly figure is
    // normally dated — the week ending on that era.
    eras: keep.map((i) => rollup.eraTo[i] as number),
    eraStart: keep.map((i) => rollup.weekStart[i] as number),
    network,
    // Deliberately empty. See the note above: no per-operator data exists here,
    // and fabricating it from the network average would be a chart of nothing.
    operators: {},
    resolution: 'week',
  };
}

/**
 * Above this many eras, a range is served from the rollup.
 *
 * A year is the longest range that stays comfortably inside the chunk budget:
 * 365 eras is about twelve chunks, which is what the site already loads today.
 * Beyond that the chunk count grows without bound while the questions get
 * coarser — nobody reads a five-year chart for a single era's value.
 */
export const WEEKLY_ABOVE_ERAS = 365;

/** Whether a range should be drawn from the rollup rather than the chunks. */
export function prefersRollup(
  range: { fromEra: number; toEra: number } | null | undefined,
): boolean {
  if (!range) return false;
  return range.toEra - range.fromEra + 1 > WEEKLY_ABOVE_ERAS;
}
