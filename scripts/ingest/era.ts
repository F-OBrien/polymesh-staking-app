/**
 * Incremental era ingestion.
 *
 * Runs hourly. Reads the manifest, compares it to the chain's active era, and
 * exits immediately if nothing new has completed — which is the common case,
 * since an era on Polymesh mainnet is 24 hours. A no-op run costs one RPC call
 * and a few seconds (design doc §6.3).
 *
 *   npm run ingest:era                 # incremental
 *   npm run ingest:era -- --full       # cold rebuild over historyDepth
 *   npm run ingest:era -- --max-eras 5 # bound a catch-up run
 *
 * Deliberately conservative about load: eras are fetched with a small
 * concurrency limit against a shared public node. The pipeline can afford to be
 * slow; the browser could not, which is the entire reason this exists.
 */

import { join } from 'node:path';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';
import { CHUNK_SIZE } from '../../config/site';
import { apiAt, connect, mapWithConcurrency } from '../../lib/chain/connect';
import {
  readActiveEra,
  readCurrentEra,
  readEraTimingConsts,
  readHistoryDepth,
} from '../../lib/chain/compat';
import { groupErasByChunk, isChunkComplete } from '../../lib/data/chunking';
import { erasPerYear as computeErasPerYear } from '../../lib/metrics/staking';
import type { ChunkRef } from '../../lib/schemas/data';
import {
  blockForEra,
  buildChunk,
  eraStartFromIndex,
  fetchEra,
  readIssuanceAt,
  readStoredCoverage,
  type EraRecord,
} from './era-build';
import { contentHash, DataStore } from './store';
import { buildOperatorRegistry, collectSeenEras, mergeSpans, spansFromChunks } from './operators';
import { buildRollup } from './rollup';

/** Concurrent era fetches. Low on purpose — see the module note. */
const ERA_CONCURRENCY = 3;

interface Options {
  full: boolean;
  maxEras: number;
  outDir: string;
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string, fallback: number) => {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    const parsed = Number(argv[i + 1]);
    if (!Number.isFinite(parsed)) throw new Error(`${name} expects a number`);
    return parsed;
  };

  return {
    full: flag('--full'),
    maxEras: value('--max-eras', Number.POSITIVE_INFINITY),
    outDir: join(process.cwd(), 'public', 'data'),
  };
}

// ---------------------------------------------------------------------------
// One era
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const network = resolveNetwork();
  const endpoint = resolveRpcUrl(network);
  const store = new DataStore(options.outDir);

  console.log(`Connecting to ${network.label} at ${endpoint}`);
  const { api, disconnect } = await connect({ endpoint });

  try {
    const [activeEra, currentEra, historyDepth, timing] = await Promise.all([
      readActiveEra(api),
      readCurrentEra(api),
      readHistoryDepth(api),
      Promise.resolve(readEraTimingConsts(api)),
    ]);

    const manifest = await store.readManifest();
    // The active era is still accruing; only the era before it is final.
    const lastCompleteEra = activeEra.index - 1;

    // Oldest era still held in state. Verified against mainnet: with
    // activeEra 1746 and historyDepth 84, era 1663 has data and 1662 does not,
    // so the window is `activeEra - historyDepth + 1` and is anchored on the
    // ACTIVE era, not the last complete one. Getting this wrong by even one
    // era produces empty records that look like a chain outage.
    const oldestRetainedEra = Math.max(0, activeEra.index - historyDepth + 1);

    // The resume point is recomputed from the chunks on disk rather than read
    // from the manifest. The manifest is derived data, so trusting its cursor
    // means a single bad write — from a crash, or from an older version of this
    // script — strands every era after it, permanently and silently. Deriving
    // from the chunks makes the pipeline self-healing: whatever the manifest
    // claims, we resume from the end of the contiguous span we can actually
    // see.
    const storedCoverage = await readStoredCoverage(store, manifest?.chunks ?? []);
    if (manifest && storedCoverage && manifest.lastCompleteEra !== storedCoverage.lastEra) {
      console.warn(
        `Manifest claims eras through ${manifest.lastCompleteEra}, but only ` +
          `${storedCoverage.firstEra}-${storedCoverage.lastEra} is contiguous on disk. ` +
          'Resuming from the data, not the manifest.',
      );
    }

    const firstWanted = options.full
      ? oldestRetainedEra
      : Math.max(oldestRetainedEra, (storedCoverage?.lastEra ?? oldestRetainedEra - 1) + 1);

    if (firstWanted > lastCompleteEra) {
      console.log(
        `Up to date: era ${lastCompleteEra} already ingested (active era ${activeEra.index}). ` +
          'Nothing to do.',
      );
      return;
    }

    const wanted: number[] = [];
    for (
      let era = firstWanted;
      era <= lastCompleteEra && wanted.length < options.maxEras;
      era += 1
    ) {
      wanted.push(era);
    }

    const erasPerYear = computeErasPerYear(timing);
    const eraSeconds =
      (timing.expectedBlockTimeMs * timing.epochDurationBlocks * timing.sessionsPerEra) / 1000;
    const activeEraStartSeconds =
      activeEra.startMs != null
        ? Math.floor(activeEra.startMs / 1000)
        : Math.floor(Date.now() / 1000);

    /**
     * Per-era anchors, from `era-index.json` where it is available.
     *
     * Both values used to be approximations, and the backfill exposed both by
     * disagreeing with its own neighbour across the boundary:
     *
     *  - **Issuance** has no per-era storage, so this stamped today's figure
     *    onto every era it wrote. Right for one era that just ended; across a
     *    cold rebuild of eighty-four it is a flat line where the real series
     *    grows by a reward a day, and the staking ratio derived from it drifts
     *    with it.
     *  - **Era start** was extrapolated backwards at a nominal era length.
     *    Measured drift over the chain's life is large enough that
     *    extrapolation is days out at the far end.
     *
     * The index makes both exact for the cost of one archive read per era.
     * Absent, the old approximations still apply and the run says so, because
     * a pipeline that silently degrades is worse than one that is merely
     * approximate.
     */
    const eraIndex = await store.readEraIndex();
    if (!eraIndex) {
      console.warn(
        'era-index.json is missing: falling back to today’s issuance and an extrapolated ' +
          'era start for every era written. Run `npm run ingest:era-index` for exact values.',
      );
    }
    const issuanceNow = await readIssuanceAt(api);

    const fetched = await mapWithConcurrency(wanted, ERA_CONCURRENCY, async (era) => {
      const indexedStart = eraIndex ? eraStartFromIndex(eraIndex, era) : null;
      const startSeconds =
        indexedStart ?? Math.floor(activeEraStartSeconds - (activeEra.index - era) * eraSeconds);

      // Issuance as it stood when this era ended, where the index can point us
      // at the block. `readIssuanceAt` on a historical view is one archive
      // round trip; on the usual single-era incremental run that is one call.
      let issuance = issuanceNow;
      const block = eraIndex ? blockForEra(eraIndex, era) : null;
      if (block != null) {
        try {
          const hash = (await api.rpc.chain.getBlockHash(block)).toString();
          issuance = await readIssuanceAt(await apiAt(api, hash));
        } catch {
          // Fall back to today's figure rather than failing the run: a stale
          // issuance is a small inaccuracy, a missing era is a hole.
        }
      }

      const record = await fetchEra(api, era, startSeconds, issuance);

      // An era with neither points nor exposures has been pruned from state.
      // That is expected right at the edge of the history window — and the edge
      // can move mid-run, since a long ingest may straddle an era rollover.
      // Writing the empty record would put a false gap in the series that looks
      // like a chain outage, so it is dropped instead.
      if (record.totalPoints <= 0n && record.operators.length === 0) {
        console.warn(`  era ${era}: no data on chain (aged out of history) — skipping`);
        return null;
      }

      console.log(`  era ${era}: ${record.operators.length} operators`);
      return record;
    });

    const records = fetched.filter((record): record is EraRecord => record !== null);

    if (records.length === 0) {
      console.log('No eras with data in the requested range. Nothing written.');
      return;
    }

    const tokenDecimals = api.registry.chainDecimals[0] as number;

    // --- chunks ---
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

    // --- operators registry ---
    const registry = await buildOperatorRegistry({
      api,
      store,
      // Spans come from every chunk on disk, merged with this run's own
      // records. Deriving rather than only accumulating is what lets a wrong
      // `firstSeenEra` be corrected — a min-merge alone can never raise one.
      seen: mergeSpans(await spansFromChunks(store, chunks), collectSeenEras(records)),
    });
    await store.writeOperators(registry);

    // --- weekly rollup, rebuilt from every chunk on disk ---
    // Runs BEFORE the manifest because it reports the era span actually stored,
    // which is what the manifest's cursor must record.
    const rollup = await buildRollup(store, chunks);

    // The manifest's era span is the incremental cursor, so it must describe
    // what we have *stored*, never what the chain currently offers. Recording
    // the chain's `lastCompleteEra` after a bounded run (`--max-eras`, or a run
    // that hit an error partway) made the next run believe it was up to date
    // and skip every era in between — silently, and with no gap visible in the
    // manifest to hint at it.
    const coverage = rollup.coverage ?? {
      firstEra: records[0]!.era,
      lastEra: records.at(-1)!.era,
    };

    // --- manifest ---
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

    if (rollup.gaps.length > 0) {
      console.warn(
        `  Gaps after the contiguous span: ${rollup.gaps
          .map((g) => (g.from === g.to ? `${g.from}` : `${g.from}-${g.to}`))
          .join(', ')}. The cursor stops at ${coverage.lastEra}, so the next run refills them.`,
      );
    }

    const behind = lastCompleteEra - coverage.lastEra;
    console.log(
      `Done. ${records.length} era(s) ingested; ${chunks.length} chunk(s); ` +
        `contiguous ${coverage.firstEra}-${coverage.lastEra}` +
        (behind > 0 ? `; ${behind} era(s) behind the chain — run again` : '') +
        `. Current era ${currentEra}, active ${activeEra.index}.`,
    );
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
