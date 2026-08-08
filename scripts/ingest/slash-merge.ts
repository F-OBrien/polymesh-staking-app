import type { NominatorSlashTotal, SlashEvent } from '../../lib/schemas/data';

/**
 * Reconciling a fresh slash scan with what previous runs recorded.
 *
 * Pure, and separate from `slashes.ts`, so it can be tested without importing
 * an entry point that would dial a chain on import. Same split as
 * `rollup.ts` and `era.ts`.
 *
 * The problem being solved: `validatorSlashInEra` is pruned with the rest of an
 * era's staking state, so the chain forgets offences after roughly its history
 * depth. Rebuilding purely from state would shrink the record by one era every
 * day. Carrying old events forward is the only backfill available without an
 * archive node.
 */

/**
 * Merges a fresh scan into stored history.
 *
 * The chain wins for eras it still holds — a re-read is authoritative, and
 * inside the scanned window an *absence* is real evidence that no slash
 * occurred, so a stale stored event must not survive it. Eras outside the
 * window keep their stored values, because there the chain has nothing to say.
 */
export function mergeSlashEvents(
  stored: readonly SlashEvent[],
  scanned: readonly SlashEvent[],
  scannedFrom: number,
): SlashEvent[] {
  const merged = new Map<string, SlashEvent>();

  for (const event of stored) {
    if (event.era < scannedFrom) merged.set(`${event.era}:${event.address}`, event);
  }
  for (const event of scanned) {
    merged.set(`${event.era}:${event.address}`, event);
  }

  return [...merged.values()].sort((a, b) => a.era - b.era || a.address.localeCompare(b.address));
}

/** As `mergeSlashEvents`, keyed by era alone. */
export function mergeNominatorTotals(
  stored: readonly NominatorSlashTotal[],
  scanned: readonly NominatorSlashTotal[],
  scannedFrom: number,
): NominatorSlashTotal[] {
  const merged = new Map<number, NominatorSlashTotal>();
  for (const total of stored) {
    if (total.era < scannedFrom) merged.set(total.era, total);
  }
  for (const total of scanned) merged.set(total.era, total);
  return [...merged.values()].sort((a, b) => a.era - b.era);
}
