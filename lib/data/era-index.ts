import type { EraIndexFile } from '@/lib/schemas/data';

/**
 * Era ↔ date ↔ block, over the chain's whole life.
 *
 * Chunks carry `eraStart` for the eras they hold, which is enough for a chart
 * axis and nothing else. This answers the same question for eras we hold no
 * chunk for — which is most of them, and all of the ones a years-long reward
 * history falls in.
 *
 * **Do not replace any of this with arithmetic.** An era is nominally 24 hours
 * and very nearly is, which is what makes the shortcut so tempting: measured on
 * mainnet, era 0 began 2021-10-29T17:26:12 and era 1748 began 2026-08-10T13:26,
 * so `firstStart + era × 86400` drifts about four hours across the range and
 * lands in the wrong day at the far end. Every function here is a lookup.
 *
 * All lookups are binary searches over a contiguous columnar array, so the file
 * stays ~30 KB for 1,749 eras and nothing has to be indexed on load.
 */

export interface EraIndex {
  readonly firstEra: number;
  readonly lastEra: number;
  /** Unix seconds at which `firstEra` began. */
  readonly firstStart: number;
  /** Unix seconds at which `lastEra` began. */
  readonly lastStart: number;

  /** Unix seconds the era began, or null if it is outside the index. */
  startOf(era: number): number | null;
  /** Block the era's transition was recorded in, or null. */
  blockOf(era: number): number | null;
  /** The era in progress at a moment, or null if outside the covered range. */
  eraAt(unixSeconds: number): number | null;
  /** The era in progress at a block, or null if outside the covered range. */
  eraAtBlock(block: number): number | null;
}

/**
 * Largest index whose value is <= `target`, or -1.
 *
 * The "<=" matters: an event at any moment inside era N must resolve to N, not
 * to whichever boundary happens to be nearer.
 */
function floorIndex(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((values[mid] ?? 0) <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export function createEraIndex(file: EraIndexFile): EraIndex {
  const { firstEra, block, start } = file;
  const count = start.length;
  const lastEra = firstEra + count - 1;

  const at = (era: number, column: readonly number[]): number | null => {
    const i = era - firstEra;
    return i >= 0 && i < count ? (column[i] ?? null) : null;
  };

  return {
    firstEra,
    lastEra,
    firstStart: start[0] ?? 0,
    lastStart: start.at(-1) ?? 0,

    startOf: (era) => at(era, start),
    blockOf: (era) => at(era, block),

    eraAt(unixSeconds) {
      const i = floorIndex(start, unixSeconds);
      return i < 0 ? null : firstEra + i;
    },

    eraAtBlock(blockNumber) {
      const i = floorIndex(block, blockNumber);
      return i < 0 ? null : firstEra + i;
    },
  };
}

/**
 * The era a reward was *earned in*, from the moment it was paid.
 *
 * Deliberately separate from `eraAt`, because they answer different questions.
 * A `Rewarded` event fires when a payout is *made*, and on Polymesh that
 * happens automatically as soon as the era it pays for has ended — so the era
 * whose work earned it is the one before the era the event landed in.
 *
 * Measured on mainnet rather than assumed: era 1748 ended at block 25,026,862
 * (2026-08-10T13:26:12), and that stash's payouts for it landed at block
 * 25,026,876 — fourteen blocks, about ninety seconds, later. The same pattern
 * holds in 2021, six seconds after the era boundary, so it is a property of
 * Polymesh's automatic `validators::payouts()` rather than of the current
 * runtime.
 *
 * **This is the one inference in this module**, and it is worth naming: on a
 * chain where payouts must be claimed manually, a reward could land arbitrarily
 * long after it was earned and this would be wrong. That is not how Polymesh
 * works, but if payouts ever stop being automatic, this is what breaks.
 *
 * Returns null rather than guessing outside the index: a blank cell in a CSV
 * that gets filed for reporting is honest, an invented era index is not.
 */
export function earnedEraForReward(index: EraIndex, block: number): number | null {
  // Keyed on block rather than timestamp. Both are available on a reward event
  // and both work, but the block is the chain's own exact ordinal, while the
  // indexer's datetime is a string of inconsistent width that has to be parsed.
  // There is no reason to introduce a parse where an integer will do.
  const paidIn = index.eraAtBlock(block);
  if (paidIn == null) return null;
  const earned = paidIn - 1;
  return earned >= index.firstEra ? earned : null;
}
