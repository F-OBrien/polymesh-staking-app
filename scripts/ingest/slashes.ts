/**
 * Slash ingestion.
 *
 * Rebuilds `slashes.json` wholesale on every run rather than accumulating
 * incrementally, because the source is small — one range read per era over the
 * chain's history depth, ~84 calls on mainnet — and because rebuilding is the
 * only way to notice that an era's slash record has been *pruned*.
 *
 * That pruning is the awkward part and it drives the whole design.
 * `validatorSlashInEra` lives alongside the rest of an era's staking state and
 * is cleared with it, so the chain can only tell us about roughly the last
 * three months. An era that falls out of the window leaves no trace, and an
 * empty result for it is indistinguishable from "nothing happened".
 *
 * Two consequences, both deliberate:
 *
 *  1. Previously-seen events are **retained** across runs even once the chain
 *     forgets them, so the file accumulates a longer record than state alone
 *     can provide. This is the only backfill available without an archive node.
 *  2. `prunedBefore` records where the chain's own knowledge stops, so the UI
 *     can distinguish "no offences" from "cannot say".
 *
 *   npm run ingest:slashes
 */

import { join } from 'node:path';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';
import { connect, mapWithConcurrency } from '../../lib/chain/connect';
import {
  readActiveEra,
  readEraNominatorSlashes,
  readEraSlashes,
  readHistoryDepth,
  readSlashingScope,
} from '../../lib/chain/compat';
import { toPolyx } from '../../lib/metrics/staking';
import type { NominatorSlashTotal, SlashEvent, Slashes } from '../../lib/schemas/data';
import { mergeNominatorTotals, mergeSlashEvents } from './slash-merge';
import { DataStore } from './store';

/** Concurrent era reads. Matches the era pipeline — a shared public node. */
const ERA_CONCURRENCY = 3;

const round = (value: number, dp = 6): number => Number(value.toFixed(dp));

/**
 * Reads the previous `slashes.json`, tolerating a shape it no longer matches.
 *
 * The store deliberately refuses to build on a file that fails its schema —
 * right for chunks, which are appended to and must never be corrupted. This
 * file is different: it is regenerated wholesale from chain state on every run,
 * and the only thing the old copy contributes is events for eras the chain has
 * since pruned.
 *
 * So a schema change here should cost a warning, not a failed run. Adding
 * `scope` did exactly that and aborted the pipeline until the file was deleted
 * by hand — not something to leave waiting for the next scheduled run.
 *
 * The trade is that a schema change loses pre-prune history. That is why it
 * warns loudly rather than passing over it quietly.
 */
async function readStoredLeniently(store: DataStore): Promise<Slashes | null> {
  try {
    return await store.readSlashes();
  } catch (error) {
    console.warn(
      `Existing slashes.json does not match the current schema, so previously ` +
        `recorded events cannot be carried forward. Rebuilding from chain state ` +
        `alone.\n  ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  const network = resolveNetwork();
  const endpoint = resolveRpcUrl(network);
  const store = new DataStore(join(process.cwd(), 'public', 'data'));

  console.log(`Connecting to ${network.label} at ${endpoint}`);
  const { api, disconnect } = await connect({ endpoint });

  try {
    const [activeEra, historyDepth, stored, scope] = await Promise.all([
      readActiveEra(api),
      readHistoryDepth(api),
      readStoredLeniently(store),
      readSlashingScope(api),
    ]);

    const tokenDecimals = api.registry.chainDecimals[0] ?? 6;

    // The active era is still accruing offences, so the last era worth
    // recording as settled is the one before it.
    const lastEra = Math.max(0, activeEra.index - 1);
    const scannedFrom = Math.max(0, lastEra - historyDepth + 1);

    const eras = Array.from({ length: lastEra - scannedFrom + 1 }, (_, i) => scannedFrom + i);
    console.log(`Scanning eras ${scannedFrom}-${lastEra} (history depth ${historyDepth})`);

    const perEra = await mapWithConcurrency(eras, ERA_CONCURRENCY, async (era) => {
      const [validators, nominators] = await Promise.all([
        readEraSlashes(api, era),
        readEraNominatorSlashes(api, era),
      ]);
      return { era, validators, nominators };
    });

    const scannedEvents: SlashEvent[] = perEra.flatMap(({ era, validators }) =>
      validators.map((slash) => ({
        era,
        address: slash.address,
        fraction: round(slash.fraction, 9),
        amount: round(toPolyx(slash.amount, tokenDecimals), 6),
      })),
    );

    // Only eras that actually saw nominator losses are recorded — a row of
    // zeroes per era would be most of the file and would say nothing.
    const scannedTotals: NominatorSlashTotal[] = perEra
      .filter(({ nominators }) => nominators.count > 0)
      .map(({ era, nominators }) => ({
        era,
        count: nominators.count,
        amount: round(toPolyx(nominators.total, tokenDecimals), 6),
      }));

    const events = mergeSlashEvents(stored?.events ?? [], scannedEvents, scannedFrom);
    const nominatorTotals = mergeNominatorTotals(
      stored?.nominatorTotals ?? [],
      scannedTotals,
      scannedFrom,
    );

    // The record can reach further back than the chain does, thanks to previous
    // runs. `firstEra` is how far our knowledge goes; `prunedBefore` is where
    // the chain's stops.
    const firstEra = Math.min(scannedFrom, events[0]?.era ?? scannedFrom);

    const slashes: Slashes = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scope,
      firstEra,
      lastEra,
      prunedBefore: scannedFrom > 0 ? scannedFrom : null,
      events,
      nominatorTotals,
    };

    const bytes = await store.writeSlashes(slashes);

    const carried = events.length - scannedEvents.length;
    console.log(
      [
        `Wrote slashes.json (${(bytes / 1024).toFixed(1)} KB)`,
        `  scope      slashing applies to: ${scope ?? 'unknown'}`,
        `  window     ${firstEra}-${lastEra}, chain retains from ${scannedFrom}`,
        `  events     ${events.length} (${scannedEvents.length} from chain, ${carried} carried forward)`,
        `  nominators ${nominatorTotals.length} era(s) with losses`,
      ].join('\n'),
    );
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
