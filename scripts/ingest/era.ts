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
import { connect, mapWithConcurrency } from '../../lib/chain/connect';
import {
  readActiveEra,
  readCurrentEra,
  readEraExposures,
  readEraPreferences,
  readEraReward,
  readEraRewardPoints,
  readEraTimingConsts,
  readEraTotalStake,
  readHistoryDepth,
  type ApiLike,
} from '../../lib/chain/compat';
import { groupErasByChunk, isChunkComplete } from '../../lib/data/chunking';
import {
  erasPerYear as computeErasPerYear,
  networkAverageApr,
  toPolyx,
  weightedAverageCommission,
  type OperatorEraInput,
} from '../../lib/metrics/staking';
import { distributionBand } from '../../lib/metrics/stats';
import { deriveOperatorApr } from '../../lib/metrics/derive';
import type {
  Chunk,
  ChunkRef,
  ExposureShape,
  NetworkSeries,
  OperatorSeries,
} from '../../lib/schemas/data';
import { contentHash, DataStore } from './store';
import { buildOperatorRegistry } from './operators';
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

interface EraRecord {
  era: number;
  eraStartSeconds: number;
  specVersion: number;
  exposureShape: ExposureShape;
  totalStaked: bigint;
  totalIssuance: bigint;
  validatorReward: bigint;
  totalPoints: bigint;
  operators: {
    address: string;
    points: bigint;
    totalStake: bigint;
    ownStake: bigint;
    nominatorCount: number;
    commission: number | null;
  }[];
}

async function fetchEra(
  api: ApiLike,
  era: number,
  eraStartSeconds: number,
  totalIssuance: bigint,
): Promise<EraRecord> {
  const [points, reward, totalStake, prefs, exposures] = await Promise.all([
    readEraRewardPoints(api, era),
    readEraReward(api, era),
    readEraTotalStake(api, era),
    readEraPreferences(api, era),
    readEraExposures(api, era),
  ]);

  // Union of everyone with an exposure and everyone who scored points. An
  // account can do the latter without the former, and dropping those would
  // understate total points relative to the per-operator columns.
  const addresses = new Set<string>([
    ...exposures.exposures.map((e) => e.address),
    ...points.operators.keys(),
  ]);

  const byAddress = new Map(exposures.exposures.map((e) => [e.address, e]));

  return {
    era,
    eraStartSeconds,
    specVersion: Number(api.runtimeVersion.specVersion.toString()),
    exposureShape: exposures.shape,
    totalStaked: totalStake,
    totalIssuance,
    validatorReward: reward,
    totalPoints: points.total,
    operators: [...addresses].map((address) => {
      const exposure = byAddress.get(address);
      return {
        address,
        points: points.operators.get(address) ?? 0n,
        totalStake: exposure?.total ?? 0n,
        ownStake: exposure?.own ?? 0n,
        nominatorCount: exposure?.nominatorCount ?? 0,
        // null, not 0: an absent preferences entry means unknown commission,
        // and assuming zero would overstate nominator returns.
        commission: prefs.get(address)?.commission ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Chunk assembly
// ---------------------------------------------------------------------------

const round = (value: number, dp: number): number => Number(value.toFixed(dp));

/**
 * Builds a chunk from era records, merging with whatever is already on disk.
 *
 * Merging matters for the trailing chunk, which is rewritten every time a new
 * era lands. Existing eras must survive verbatim so that a completed chunk
 * hashes identically on re-run — the idempotency guarantee the design doc makes
 * an acceptance criterion.
 */
function buildChunk(
  chunkStart: number,
  records: readonly EraRecord[],
  existing: Chunk | null,
  tokenDecimals: number,
  erasPerYear: number,
): Chunk {
  const merged = new Map<number, EraRecord>();

  // Existing eras first, so freshly fetched records win on conflict.
  if (existing) {
    for (const [i, era] of existing.eras.entries()) {
      merged.set(era, reconstructRecord(existing, i, tokenDecimals));
    }
  }
  for (const record of records) merged.set(record.era, record);

  const ordered = [...merged.values()].sort((a, b) => a.era - b.era);
  const eras = ordered.map((r) => r.era);

  const addresses = new Set<string>();
  for (const record of ordered) {
    for (const op of record.operators) addresses.add(op.address);
  }

  const network: NetworkSeries = {
    totalStaked: [],
    totalIssuance: [],
    validatorReward: [],
    totalPoints: [],
    activeOperators: [],
    nominatorCount: [],
    avgCommission: [],
    avgApr: [],
    aprP10: [],
    aprP50: [],
    aprP90: [],
  };

  const operators: Record<string, OperatorSeries> = {};
  for (const address of addresses) {
    operators[address] = {
      points: [],
      commission: [],
      totalStake: [],
      ownStake: [],
      nominatorCount: [],
    };
  }

  for (const record of ordered) {
    const present = new Map(record.operators.map((o) => [o.address, o]));

    for (const address of addresses) {
      const op = present.get(address);
      const columns = operators[address]!;
      // Precision per column: shorter numbers compress markedly better, and
      // sub-POLYX precision on a multi-million stake is far below one pixel.
      columns.points.push(op ? Number(op.points) : null);
      columns.commission.push(op?.commission != null ? round(op.commission, 4) : null);
      columns.totalStake.push(op ? Math.round(toPolyx(op.totalStake, tokenDecimals)) : null);
      columns.ownStake.push(op ? round(toPolyx(op.ownStake, tokenDecimals), 2) : null);
      columns.nominatorCount.push(op ? op.nominatorCount : null);
    }

    // Aggregates use the same functions the client uses, so a tile and a chart
    // can never disagree about what the network average was.
    const metricInputs: OperatorEraInput[] = record.operators
      .filter((o) => o.commission != null)
      .map((o) => ({
        address: o.address,
        points: o.points,
        totalStake: o.totalStake,
        commission: o.commission!,
      }));

    const perOperatorApr = record.operators.map((o) => {
      if (o.totalStake <= 0n || record.totalPoints <= 0n || o.commission == null) return null;
      const { net } = deriveOperatorApr(
        {
          points: [Number(o.points)],
          commission: [o.commission],
          totalStake: [toPolyx(o.totalStake, tokenDecimals)],
          ownStake: [0],
          nominatorCount: [0],
        },
        {
          validatorReward: [toPolyx(record.validatorReward, tokenDecimals)],
          totalPoints: [Number(record.totalPoints)],
        },
        erasPerYear,
      );
      return net[0] ?? null;
    });

    const band = distributionBand(perOperatorApr);

    network.totalStaked.push(Math.round(toPolyx(record.totalStaked, tokenDecimals)));
    network.totalIssuance.push(Math.round(toPolyx(record.totalIssuance, tokenDecimals)));
    network.validatorReward.push(round(toPolyx(record.validatorReward, tokenDecimals), 3));
    network.totalPoints.push(Number(record.totalPoints));
    network.activeOperators.push(record.operators.filter((o) => o.totalStake > 0n).length);
    network.nominatorCount.push(record.operators.reduce((s, o) => s + o.nominatorCount, 0));
    network.avgCommission.push(
      round(weightedAverageCommission(metricInputs, record.totalPoints), 5),
    );
    network.avgApr.push(
      round(
        networkAverageApr({
          operators: metricInputs,
          eraReward: record.validatorReward,
          totalPoints: record.totalPoints,
          erasPerYear,
        }),
        5,
      ),
    );
    network.aprP10.push(round(band.p10 ?? 0, 5));
    network.aprP50.push(round(band.p50 ?? 0, 5));
    network.aprP90.push(round(band.p90 ?? 0, 5));
  }

  return {
    from: chunkStart,
    to: chunkStart + CHUNK_SIZE - 1,
    eras: eras as [number, ...number[]],
    eraStart: ordered.map((r) => r.eraStartSeconds),
    network,
    operators,
    provenance: {
      specVersion: ordered.map((r) => r.specVersion),
      exposureShape: ordered.map((r) => r.exposureShape),
      source: ordered.map(() => 'live' as const),
    },
  };
}

/**
 * Rebuilds an `EraRecord` from an already-written chunk column set.
 *
 * Lossy by design: chunks store rounded POLYX, so re-deriving aggregates from
 * this would drift. It is used only to carry existing eras through a merge
 * unchanged, and every value it reproduces is written back at the same
 * precision it was read at.
 */
function reconstructRecord(chunk: Chunk, index: number, tokenDecimals: number): EraRecord {
  const scale = 10 ** tokenDecimals;
  const toBase = (polyx: number | null): bigint =>
    polyx == null ? 0n : BigInt(Math.round(polyx * scale));

  const operators = Object.entries(chunk.operators)
    .filter(([, series]) => series.points[index] != null || series.totalStake[index] != null)
    .map(([address, series]) => ({
      address,
      points: BigInt(Math.round(series.points[index] ?? 0)),
      totalStake: toBase(series.totalStake[index] ?? null),
      ownStake: toBase(series.ownStake[index] ?? null),
      nominatorCount: series.nominatorCount[index] ?? 0,
      commission: series.commission[index] ?? null,
    }));

  return {
    era: chunk.eras[index]!,
    eraStartSeconds: chunk.eraStart[index]!,
    specVersion: chunk.provenance.specVersion[index]!,
    exposureShape: chunk.provenance.exposureShape[index]!,
    totalStaked: toBase(chunk.network.totalStaked[index] ?? null),
    totalIssuance: toBase(chunk.network.totalIssuance[index] ?? null),
    validatorReward: toBase(chunk.network.validatorReward[index] ?? null),
    totalPoints: BigInt(Math.round(chunk.network.totalPoints[index] ?? 0)),
    operators,
  };
}

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

    const firstWanted = options.full
      ? Math.max(0, lastCompleteEra - historyDepth)
      : (manifest?.lastCompleteEra ?? Math.max(0, lastCompleteEra - historyDepth)) + 1;

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

    // Total issuance is a "now" value; it is not retained per era. Recording
    // today's figure against a historical era would be wrong, so it is only
    // meaningful for recent eras — acceptable because the staking-ratio series
    // is presented as approximate for backfilled history.
    const totalIssuance = await (await import('../../lib/chain/compat')).readTotalIssuance(api);

    console.log(
      `Ingesting eras ${wanted[0]}-${wanted.at(-1)} (${wanted.length}) at concurrency ${ERA_CONCURRENCY}`,
    );

    const records = await mapWithConcurrency(wanted, ERA_CONCURRENCY, async (era) => {
      const startSeconds = activeEraStartSeconds - (activeEra.index - era) * eraSeconds;
      const record = await fetchEra(api, era, Math.floor(startSeconds), totalIssuance);
      console.log(`  era ${era}: ${record.operators.length} operators`);
      return record;
    });

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
    const firstEra = manifest?.firstEra ?? wanted[0]!;

    // --- operators registry ---
    const registry = await buildOperatorRegistry({
      api,
      store,
      seenAddresses: new Set(records.flatMap((r) => r.operators.map((o) => o.address))),
      firstEra: wanted[0]!,
      lastEra: lastCompleteEra,
    });
    await store.writeOperators(registry);

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
      firstEra,
      lastCompleteEra,
      erasPerYear,
      chunkSize: CHUNK_SIZE,
      chunks,
    });

    // --- weekly rollup, rebuilt from every chunk on disk ---
    await buildRollup(store, chunks);

    console.log(
      `Done. ${wanted.length} era(s) ingested; ${chunks.length} chunk(s); ` +
        `current era ${currentEra}, active ${activeEra.index}.`,
    );
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
