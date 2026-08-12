/**
 * Turning chain reads into era records, and era records into chunks.
 *
 * Extracted from `era.ts` so `backfill.ts` can share it. The two scripts differ
 * only in *where* they point the API — the incremental one at current state,
 * the backfill at a historical block via `api.at()` — and everything after that
 * read has to be identical, or a backfilled era would be subtly incomparable
 * with a natively ingested one sitting next to it in the same chunk.
 *
 * Nothing here connects, writes a manifest, or parses arguments. It is the part
 * both entry points must agree on.
 */

import { CHUNK_SIZE } from '../../config/site';
import {
  readEraExposures,
  readEraPreferences,
  readEraReward,
  readEraRewardPoints,
  readEraTotalStake,
  type ApiLike,
} from '../../lib/chain/compat';
import {
  networkAverageApr,
  toPolyx,
  weightedAverageCommission,
  type OperatorEraInput,
} from '../../lib/metrics/staking';
import { distributionBand } from '../../lib/metrics/stats';
import { deriveOperatorApr } from '../../lib/metrics/derive';
import { analyseCoverage } from './rollup';
import type {
  Chunk,
  EraIndexFile,
  ChunkRef,
  EraSource,
  ExposureShape,
  NetworkSeries,
  OperatorSeries,
} from '../../lib/schemas/data';
import type { DataStore } from './store';

export interface EraRecord {
  era: number;
  /** How this record reached us — see `EraSourceSchema`. */
  source: EraSource;
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

export async function fetchEra(
  api: ApiLike,
  era: number,
  eraStartSeconds: number,
  totalIssuance: bigint,
  source: EraSource = 'live',
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
    source,
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
export function buildChunk(
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
      source: ordered.map((r) => r.source),
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
export function reconstructRecord(chunk: Chunk, index: number, tokenDecimals: number): EraRecord {
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
    // Carried through, not defaulted: a chunk holding both backfilled and
    // natively ingested eras is rewritten whole every time a new era lands, and
    // defaulting here would quietly relabel the backfilled ones as live —
    // destroying the only record of which eras a bad backfill wrote.
    source: chunk.provenance.source[index] ?? 'live',
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

/**
 * Contiguous era span actually present in the chunks on disk.
 *
 * Reads the chunk files rather than believing the manifest, so a corrupt or
 * out-of-date cursor cannot strand history. Missing or unreadable chunks are
 * skipped: a gap is exactly what this is meant to detect.
 */
export async function readStoredCoverage(
  store: DataStore,
  refs: readonly ChunkRef[],
): Promise<{ firstEra: number; lastEra: number } | null> {
  const eras: number[] = [];

  for (const ref of [...refs].sort((a, b) => a.from - b.from)) {
    try {
      const chunk = await store.readChunk(ref.from);
      if (chunk) eras.push(...chunk.eras);
    } catch {
      // Unreadable chunk: treat as absent so the run refills it.
    }
  }

  return analyseCoverage(eras).coverage;
}

/**
 * How far *after* the era transition to read era N's storage.
 *
 * Reading inside era N looks obviously right and is wrong, which the first run
 * of this script proved against mainnet:
 *
 *  - `erasValidatorReward(N)` is written when era N is **paid out**, at the
 *    transition. Read ten blocks earlier it is `None`, so the reward decodes as
 *    zero, and every figure derived from it — APR, the percentile band, the
 *    network average — comes out zero too.
 *  - `erasRewardPoints(N)` *accumulates* through the era. Ten blocks early it
 *    was short by exactly 200 points: ten blocks at twenty points each.
 *
 * Era N's storage is retained for `historyDepth` eras after it ends, so reading
 * just after the transition is both complete and safe. A few blocks of margin
 * absorbs the transition landing across two blocks.
 */
export const BLOCKS_AFTER_TRANSITION = 10;

/** The block to read era N's storage at, from the era index. */
export function blockForEra(index: EraIndexFile, era: number): number | null {
  // `block[i]` is the start block of era `firstEra + i`, so `block[N + 1]` is
  // where era N ended and was paid out. Just after that is the first point at
  // which era N's record is complete — see `BLOCKS_AFTER_TRANSITION`.
  const next = era + 1 - index.firstEra;
  if (next <= 0 || next >= index.block.length) {
    // No following era recorded — this is the newest era in the index, which
    // `ingest:era` owns anyway.
    return null;
  }
  return (index.block[next] as number) + BLOCKS_AFTER_TRANSITION;
}

/**
 * Total issuance as of whatever block `api` is pointed at.
 *
 * Split out because both entry points need it and both were getting it wrong
 * in the same way. Issuance is a "now" value with no per-era storage, so
 * `ingest:era` stamped today's figure onto every era it wrote. For one era
 * that just ended that is right; across a cold rebuild of eighty-four eras it
 * writes a flat line where the real series grows by about a reward a day, and
 * the staking-ratio series derived from it is wrong by up to a couple of
 * percent at the far end. The backfill made this visible by disagreeing with
 * its own neighbour across the boundary — 1.2768bn against a frozen 1.3060bn.
 */
export async function readIssuanceAt(api: ApiLike): Promise<bigint> {
  const { readTotalIssuance } = await import('../../lib/chain/compat');
  return readTotalIssuance(api);
}

/** Era N's start time from the index, or null when it is not covered. */
export function eraStartFromIndex(index: EraIndexFile, era: number): number | null {
  return index.start[era - index.firstEra] ?? null;
}
