/**
 * Deep-history backfill from the archive node.
 *
 * `ingest:era` can only reach back `historyDepth` eras — 84 of them, so about
 * twelve weeks. Everything older has been pruned from current state, which is
 * why `/operators` reports operators as first seen three months ago when some
 * have been validating since era 0, and why every chart on the site is drawn
 * over a window far shorter than the chain's life.
 *
 * The eras are still readable. The public Polymesh RPCs are archive nodes, so
 * `api.at(hashOfSomeBlockWhileEraNWasLive)` still decodes era N's storage —
 * verified by `npm run probe:archive` across spec versions 3000 to 7004001, era
 * 0 included. This walks that.
 *
 *   npm run ingest:backfill                      # everything missing, oldest first
 *   npm run ingest:backfill -- --max-eras 20     # a bounded slice
 *   npm run ingest:backfill -- --from 1200 --to 1300
 *   npm run ingest:backfill -- --dry-run         # read and report, write nothing
 *   npm run ingest:backfill -- --force …         # refetch eras already on disk
 *
 * **Run it by hand.** It is not on a schedule and should not be: it is
 * thousands of prefix scans against someone else's public node, and once an era
 * is written it never changes, so there is nothing to re-run for. The two
 * scheduled workflows keep the recent window fresh; this fills the past once.
 *
 * Three things make a backfilled era *better* than a live-ingested one, not
 * merely equal:
 *
 *  - **Total issuance is read at the block**, so it is the issuance that
 *    actually applied. `ingest:era` records today's figure against every era it
 *    writes, which is right for an era that just ended and increasingly wrong
 *    going back.
 *  - **Era start comes from `era-index.json`**, which is the indexer's record of
 *    when each transition happened, rather than extrapolated backwards at a
 *    nominal 24 hours an era. Measured drift over 1,749 eras is large enough
 *    that extrapolation would be days out at the far end.
 *  - **Provenance is recorded** as `backfill-archive`, so if this run ever
 *    proves subtly wrong it can be dropped by exactly the eras it wrote.
 */

import { join } from 'node:path';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';
import { CHUNK_SIZE } from '../../config/site';
import { apiAt, connect, mapWithConcurrency } from '../../lib/chain/connect';
import {
  readActiveEra,
  readEraTimingConsts,
  readHistoryDepth,
  type ApiLike,
} from '../../lib/chain/compat';
import { groupErasByChunk, isChunkComplete } from '../../lib/data/chunking';
import { erasPerYear as computeErasPerYear } from '../../lib/metrics/staking';
import type { ChunkRef } from '../../lib/schemas/data';
import { blockForEra, buildChunk, fetchEra, readIssuanceAt, type EraRecord } from './era-build';
import { contentHash, DataStore } from './store';
import { buildOperatorRegistry } from './operators';
import { buildRollup } from './rollup';

/**
 * Concurrent archive reads.
 *
 * Lower than the incremental ingest's three. Each era here is an `api.at()`,
 * which makes the node serve historical state and — on the first block of a
 * spec version — its metadata too. This job has no deadline; the node is
 * shared.
 */
const CONCURRENCY = 2;

interface Options {
  from: number | null;
  to: number | null;
  maxEras: number;
  dryRun: boolean;
  /** Refetch eras already on disk. For redoing a backfill found to be wrong. */
  force: boolean;
  outDir: string;
}

function parseArgs(argv: readonly string[]): Options {
  const value = (name: string): number | null => {
    const i = argv.indexOf(name);
    if (i === -1) return null;
    const parsed = Number(argv[i + 1]);
    if (!Number.isFinite(parsed)) throw new Error(`${name} expects a number`);
    return parsed;
  };

  return {
    from: value('--from'),
    to: value('--to'),
    maxEras: value('--max-eras') ?? Number.POSITIVE_INFINITY,
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    outDir: join(process.cwd(), 'public', 'data'),
  };
}

/**
 * Every era already on disk, so a resumed run does not refetch it.
 *
 * Read from the chunks rather than the manifest, for the same reason
 * `ingest:era` does: the manifest is derived, and trusting a stale cursor here
 * would mean refetching thousands of eras or skipping them.
 */
async function storedEras(store: DataStore, refs: readonly ChunkRef[]): Promise<Set<number>> {
  const present = new Set<number>();
  for (const ref of refs) {
    try {
      const chunk = await store.readChunk(ref.from);
      for (const era of chunk?.eras ?? []) present.add(era);
    } catch {
      // Unreadable chunk: treat its eras as missing so this run refills them.
    }
  }
  return present;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const network = resolveNetwork();
  const endpoint = resolveRpcUrl(network);
  const store = new DataStore(options.outDir);

  const eraIndex = await store.readEraIndex();
  if (!eraIndex) {
    throw new Error(
      'public/data/era-index.json is missing. Run `npm run ingest:era-index` first — ' +
        'the backfill needs every era’s start block and cannot derive them from the chain ' +
        'cheaply.',
    );
  }

  console.log(`Connecting to ${network.label} at ${endpoint}`);
  const { api, disconnect } = await connect({ endpoint });

  try {
    const [activeEra, historyDepth, timing] = await Promise.all([
      readActiveEra(api),
      readHistoryDepth(api),
      Promise.resolve(readEraTimingConsts(api)),
    ]);

    const manifest = await store.readManifest();
    const already = await storedEras(store, manifest?.chunks ?? []);

    // Where the incremental ingest takes over. Backfilling into the retained
    // window would duplicate work `ingest:era` does better — it reads current
    // state, with no archive round-trip.
    const newestToBackfill = Math.min(
      activeEra.index - historyDepth,
      eraIndex.firstEra + eraIndex.start.length - 2,
    );
    const oldest = Math.max(options.from ?? eraIndex.firstEra, eraIndex.firstEra);
    const newest = Math.min(options.to ?? newestToBackfill, newestToBackfill);

    const wanted: number[] = [];
    for (let era = oldest; era <= newest && wanted.length < options.maxEras; era += 1) {
      if (options.force || !already.has(era)) wanted.push(era);
    }

    console.log(
      `Era index covers ${eraIndex.firstEra}-${eraIndex.firstEra + eraIndex.start.length - 1}. ` +
        `Active era ${activeEra.index}, history depth ${historyDepth}, so the archive owns ` +
        `everything up to era ${newestToBackfill}.`,
    );
    console.log(`${already.size} era(s) already on disk.`);

    if (wanted.length === 0) {
      console.log('Nothing to backfill in that range.');
      return;
    }

    console.log(
      `Backfilling ${wanted.length} era(s), ${wanted[0]}-${wanted.at(-1)}, ` +
        `at concurrency ${CONCURRENCY}${options.dryRun ? ' (dry run)' : ''}`,
    );

    const started = Date.now();
    let done = 0;

    const fetched = await mapWithConcurrency(wanted, CONCURRENCY, async (era) => {
      const block = blockForEra(eraIndex, era);
      if (block == null) {
        console.warn(`  era ${era}: no start block in the index — skipping`);
        return null;
      }

      let at: ApiLike;
      try {
        const hash = (await api.rpc.chain.getBlockHash(block)).toString();
        at = await apiAt(api, hash);
      } catch (error) {
        console.warn(`  era ${era}: block ${block} unreadable — ${(error as Error).message}`);
        return null;
      }

      // Read at the block, not from current state: this is the figure that
      // actually applied, and it is the reason a backfilled era's staking ratio
      // is more accurate than a live-ingested one's.
      const issuance = await readIssuanceAt(at);

      const startSeconds = eraIndex.start[era - eraIndex.firstEra];
      if (startSeconds == null) {
        console.warn(`  era ${era}: no start time in the index — skipping`);
        return null;
      }

      const record = await fetchEra(at, era, startSeconds, issuance, 'backfill-archive');

      done += 1;
      // An era with neither points nor exposures is a real gap in the chain's
      // own history rather than a pruning artefact, since era storage is
      // retained past the transition we are reading after. Still dropped,
      // because writing it would draw a hole.
      if (record.totalPoints <= 0n && record.operators.length === 0) {
        console.warn(`  era ${era}: no data at block ${block} — skipping`);
        return null;
      }

      // The bug this script shipped with, now a hard stop. A zero reward on an
      // era that scored points means the read landed before the payout was
      // written, and every APR derived from it would silently be zero. Better
      // to fail the run than to write a plausible-looking flat line.
      if (record.validatorReward <= 0n && record.totalPoints > 0n) {
        throw new Error(
          `era ${era} at block ${block}: ${record.totalPoints} points but no validator reward. ` +
            'The read landed before the era was paid out — check BLOCKS_AFTER_TRANSITION.',
        );
      }

      const rate = done / ((Date.now() - started) / 1000);
      const remaining = Math.round((wanted.length - done) / Math.max(rate, 1e-9));
      console.log(
        `  era ${era} @ block ${block}: ${record.operators.length} operators, ` +
          `spec ${record.specVersion}, ${record.exposureShape} exposures ` +
          `(${done}/${wanted.length}, ~${Math.floor(remaining / 60)}m left)`,
      );
      return record;
    });

    const records = fetched.filter((record): record is EraRecord => record !== null);
    if (records.length === 0) {
      console.log('No eras returned data. Nothing written.');
      return;
    }

    if (options.dryRun) {
      console.log(`Dry run: ${records.length} era(s) read successfully, nothing written.`);
      return;
    }

    const tokenDecimals = api.registry.chainDecimals[0] as number;
    const erasPerYear = computeErasPerYear(timing);
    const lastCompleteEra = activeEra.index - 1;

    const grouped = groupErasByChunk(records.map((r) => r.era));
    const refs = new Map<number, ChunkRef>((manifest?.chunks ?? []).map((ref) => [ref.from, ref]));

    for (const [chunkStart, eras] of [...grouped].sort((a, b) => a[0] - b[0])) {
      const existing = await store.readChunk(chunkStart);
      const forChunk = records.filter((r) => eras.includes(r.era));
      const chunk = buildChunk(chunkStart, forChunk, existing, tokenDecimals, erasPerYear);

      await store.writeChunk(chunkStart, chunk);
      refs.set(chunkStart, {
        from: chunk.from,
        to: chunk.to,
        path: `chunks/${chunkStart}.json`,
        hash: contentHash(chunk),
        complete: isChunkComplete(chunkStart, chunk.eras.length, lastCompleteEra),
      });
    }

    const chunks = [...refs.values()].sort((a, b) => a.from - b.from);

    // The registry's first/last-seen span has to widen to whatever this run
    // reached — the whole point of the exercise is that operators have been
    // active far longer than the retained window suggests.
    const registry = await buildOperatorRegistry({
      api,
      store,
      seenAddresses: new Set(records.flatMap((r) => r.operators.map((o) => o.address))),
      firstEra: records[0]!.era,
      lastEra: records.at(-1)!.era,
    });
    await store.writeOperators(registry);

    const rollup = await buildRollup(store, chunks);
    const coverage = rollup.coverage ?? {
      firstEra: records[0]!.era,
      lastEra: records.at(-1)!.era,
    };

    await store.writeManifest({
      schemaVersion: 1,
      chain: {
        name: api.runtimeVersion.specName.toString(),
        genesisHash: api.genesisHash.toString(),
        tokenSymbol: (api.registry.chainTokens[0] as string) ?? 'POLYX',
        tokenDecimals,
      },
      generatedAt: new Date().toISOString(),
      activeEra: activeEra.index,
      firstEra: coverage.firstEra,
      lastCompleteEra: coverage.lastEra,
      erasPerYear,
      chunkSize: CHUNK_SIZE,
      chunks,
    });

    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    console.log(
      `Done in ${minutes}m. ${records.length} era(s) backfilled; ${chunks.length} chunk(s) on disk; ` +
        `contiguous ${coverage.firstEra}-${coverage.lastEra}.`,
    );

    if (rollup.gaps.length > 0) {
      // Expected mid-backfill and worth stating plainly: the contiguous span
      // the site can draw only extends once the hole between the backfilled
      // eras and the retained window is closed.
      console.warn(
        `  Still missing: ${rollup.gaps
          .map((g) => (g.from === g.to ? `${g.from}` : `${g.from}-${g.to}`))
          .join(', ')}. Run again to continue.`,
      );
    }
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
