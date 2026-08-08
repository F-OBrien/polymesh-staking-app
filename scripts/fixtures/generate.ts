/**
 * Deterministic synthetic dataset generator.
 *
 * Why this exists: the pipeline needs a live archive RPC node, which is not
 * available in every environment (CI sandboxes, offline work, contributors
 * without an endpoint). Without it, nothing downstream of the data layer could
 * be built or tested. This produces a schema-valid dataset with the same shape
 * and roughly the same statistics as mainnet, so charts, tables and visual
 * regression tests all have something honest to run against.
 *
 * It is **not** a mock in the testing sense — output goes through the same Zod
 * schemas as real data, so a schema change breaks this generator immediately
 * rather than silently diverging.
 *
 * Deterministic by construction: same seed, byte-identical output. That makes
 * it usable as a visual-regression baseline.
 *
 *   npm run fixtures -- --eras 200 --operators 100 --seed 42
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CHUNK_SIZE } from '../../config/site';
import { chunkPath, groupErasByChunk, isChunkComplete } from '../../lib/data/chunking';
import {
  ChunkSchema,
  LatestSchema,
  ManifestSchema,
  OperatorRegistrySchema,
  RollupSchema,
  type Chunk,
  type ChunkRef,
  type OperatorRecord,
  type OperatorSeries,
} from '../../lib/schemas/data';
import {
  erasPerYear,
  networkAverageApr,
  operatorApr,
  weightedAverageCommission,
  type EraTimingConsts,
} from '../../lib/metrics/staking';
import { distributionBand } from '../../lib/metrics/stats';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and stable across Node versions. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * Draws from a rough log-normal, which is how validator stake actually
 * distributes — a few large operators and a long tail, not a bell curve.
 * A uniform distribution here would make the decentralisation metrics
 * meaningless.
 */
function logNormal(rng: () => number, median: number, sigma: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * normal);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Options {
  eras: number;
  operators: number;
  seed: number;
  outDir: string;
}

const TIMING: EraTimingConsts = {
  expectedBlockTimeMs: 6000,
  epochDurationBlocks: 3600,
  sessionsPerEra: 4,
};

const TOKEN_DECIMALS = 6;
const BASE = 10n ** BigInt(TOKEN_DECIMALS);
const EPY = erasPerYear(TIMING);
const ERA_SECONDS = 24 * 60 * 60;

/** Plausible mainnet-ish figures, in whole POLYX. */
const TOTAL_ISSUANCE_START = 1_000_000_000;
const STAKING_RATIO_START = 0.52;
const FIXED_YEARLY_REWARD = 140_000_000;

function parseArgs(argv: readonly string[]): Options {
  const get = (flag: string, fallback: number): number => {
    const i = argv.indexOf(flag);
    if (i === -1) return fallback;
    const value = Number(argv[i + 1]);
    if (!Number.isFinite(value)) throw new Error(`${flag} expects a number`);
    return value;
  };
  return {
    eras: get('--eras', 200),
    operators: get('--operators', 100),
    seed: get('--seed', 42),
    outDir: join(process.cwd(), 'public', 'data'),
  };
}

// ---------------------------------------------------------------------------
// Operator population
// ---------------------------------------------------------------------------

interface SyntheticOperator {
  address: string;
  record: OperatorRecord;
  /** Long-run stake in POLYX; drifts era to era. */
  baseStake: number;
  commission: number;
  /** Relative block-production ability; 1.0 is average. */
  reliability: number;
  /** Eras this operator is present for, as an inclusive window. */
  joinEra: number;
  leaveEra: number;
}

/**
 * Generates an SS58-shaped address. Not a valid encoding — nothing in the app
 * decodes these — but the right alphabet and length so truncation, monospace
 * alignment and column widths behave as they will with real data.
 */
function syntheticAddress(rng: () => number): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let out = '2';
  for (let i = 0; i < 47; i += 1) {
    out += alphabet[Math.floor(rng() * alphabet.length)]!;
  }
  return out;
}

const OPERATOR_NAMES = [
  'Assetera',
  'B89',
  'Balance',
  'BDACS',
  'Binance',
  'Bitalo',
  'Black Manta CP',
  'Calico Capital',
  'CM Equity',
  'DigiClear',
  'DigiShares',
  'DigiVault',
  'EchoChain',
  'Elseware',
  'Entoro',
  'Etana',
  'Fortuna Custody',
  'GATENet',
  'Genesis Block',
  'Greentrail',
  'Huobi',
  'KDAC',
  'Marketlend',
  'MyCointainer',
  'Nyala',
  'Oasis Pro Markets',
  'Polymesh Assoc.',
  'Polymesh Genesis',
  'Rynco Finance',
  'Saxon Advisors',
  'Scrypt',
  'Sors',
  'Tokenise',
  'Van Sterling',
  'Vero Pulse',
  'ZenCrypto',
];

function buildOperators(rng: () => number, count: number, firstEra: number, lastEra: number) {
  const operators: SyntheticOperator[] = [];

  for (let i = 0; i < count; i += 1) {
    // Mirror mainnet's shape: most identities run three nodes.
    const name = OPERATOR_NAMES[i % OPERATOR_NAMES.length]!;
    const nodeIndex = Math.floor(i / OPERATOR_NAMES.length) + 1;
    const address = syntheticAddress(rng);

    // A minority join late or leave early, so the UI meets gaps in the data.
    const joinsLate = rng() < 0.12;
    const leavesEarly = rng() < 0.06;
    const joinEra = joinsLate
      ? Math.floor(between(rng, firstEra, firstEra + (lastEra - firstEra) * 0.6))
      : firstEra;
    const leaveEra = leavesEarly ? Math.floor(between(rng, joinEra + 10, lastEra)) : lastEra;

    operators.push({
      address,
      baseStake: logNormal(rng, 4_000_000, 0.8),
      // Most operators cluster low; a few charge a lot.
      commission: rng() < 0.85 ? between(rng, 0, 0.15) : between(rng, 0.15, 0.6),
      reliability: between(rng, 0.82, 1.12),
      joinEra,
      leaveEra,
      record: {
        did: `0x${createHash('sha256').update(address).digest('hex')}`,
        name,
        nodeLabel: `${name} ${nodeIndex}`,
        website:
          rng() < 0.6 ? `https://example.invalid/${name.toLowerCase().replace(/\W+/g, '-')}` : null,
        firstSeenEra: joinEra,
        lastSeenEra: leaveEra,
        status: leaveEra < lastEra ? 'inactive' : rng() < 0.9 ? 'active' : 'waiting',
      },
    });
  }

  return operators;
}

// ---------------------------------------------------------------------------
// Era simulation
// ---------------------------------------------------------------------------

interface EraSample {
  era: number;
  eraStart: number;
  totalIssuance: number;
  totalStaked: number;
  validatorReward: number;
  totalPoints: number;
  active: {
    op: SyntheticOperator;
    points: number;
    stake: number;
    ownStake: number;
    nominatorCount: number;
    reward: number;
    aprNet: number;
    aprGross: number;
  }[];
  avgCommission: number;
  avgApr: number;
  aprP10: number;
  aprP50: number;
  aprP90: number;
}

function simulateEra(
  rng: () => number,
  era: number,
  index: number,
  eraStart: number,
  operators: readonly SyntheticOperator[],
): EraSample {
  // Supply and stake drift slowly, with noise — not a straight line.
  const drift = index / 365;
  const totalIssuance = TOTAL_ISSUANCE_START * (1 + 0.07 * drift) * between(rng, 0.9995, 1.0005);
  const stakingRatio =
    STAKING_RATIO_START + 0.06 * Math.sin(drift * Math.PI) + between(rng, -0.004, 0.004);
  const totalStaked = totalIssuance * stakingRatio;

  // Issuance is capped, so the per-era reward is the capped annual figure
  // spread across the year — the same cap the real curve applies.
  const validatorReward = (FIXED_YEARLY_REWARD / EPY) * between(rng, 0.97, 1.03);

  const present = operators.filter((op) => era >= op.joinEra && era <= op.leaveEra);

  // Points: reliability times noise, occasionally a bad era (offline node).
  const withPoints = present.map((op) => {
    const offline = rng() < 0.015;
    const points = offline
      ? Math.round(between(rng, 0, 200))
      : Math.round(op.reliability * between(rng, 900, 1400));
    return { op, points };
  });

  const totalPoints = withPoints.reduce((sum, o) => sum + o.points, 0);
  const rewardBase = BigInt(Math.round(validatorReward)) * BASE;
  const totalPointsBig = BigInt(totalPoints);

  const active = withPoints.map(({ op, points }) => {
    const stake = op.baseStake * between(rng, 0.97, 1.03) * (1 + 0.15 * drift);
    const ownStake = stake * between(rng, 0.02, 0.2);
    const stakeBase = BigInt(Math.round(stake)) * BASE;

    const { gross, net } = operatorApr({
      eraReward: rewardBase,
      operatorPoints: BigInt(points),
      totalPoints: totalPointsBig,
      operatorTotalStake: stakeBase,
      commission: op.commission,
      erasPerYear: EPY,
    });

    return {
      op,
      points,
      stake,
      ownStake,
      nominatorCount: Math.max(1, Math.round(logNormal(rng, 40, 0.9))),
      reward: (validatorReward * points) / Math.max(totalPoints, 1),
      aprNet: net,
      aprGross: gross,
    };
  });

  const metricInputs = active.map((a) => ({
    address: a.op.address,
    points: BigInt(a.points),
    totalStake: BigInt(Math.round(a.stake)) * BASE,
    commission: a.op.commission,
  }));

  const band = distributionBand(active.map((a) => a.aprNet));

  return {
    era,
    eraStart,
    totalIssuance,
    totalStaked,
    validatorReward,
    totalPoints,
    active,
    avgCommission: weightedAverageCommission(metricInputs, totalPointsBig),
    avgApr: networkAverageApr({
      operators: metricInputs,
      eraReward: rewardBase,
      totalPoints: totalPointsBig,
      erasPerYear: EPY,
    }),
    aprP10: band.p10 ?? 0,
    aprP50: band.p50 ?? 0,
    aprP90: band.p90 ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const round = (value: number, dp = 6): number => Number(value.toFixed(dp));

function buildChunk(
  chunkStart: number,
  samples: readonly EraSample[],
  operators: readonly SyntheticOperator[],
): Chunk {
  const eras = samples.map((s) => s.era);
  const byEra = new Map(samples.map((s) => [s.era, s]));

  // Only operators that appear at least once in this chunk get a column set;
  // including every operator everywhere would bloat the file with nulls.
  const present = operators.filter((op) =>
    samples.some((s) => s.active.some((a) => a.op.address === op.address)),
  );

  const operatorSeries: Record<string, OperatorSeries> = {};
  for (const op of present) {
    const columns: OperatorSeries = {
      points: [],
      commission: [],
      totalStake: [],
      ownStake: [],
      nominatorCount: [],
    };

    for (const era of eras) {
      const entry = byEra.get(era)?.active.find((a) => a.op.address === op.address);
      // null, not 0: absent from the active set is not the same as scoring
      // nothing, and averaging the two together would be wrong.
      //
      // Precision is chosen per column rather than uniformly — shorter numbers
      // compress substantially better, and trailing noise digits carry no
      // information a chart can show. Stake is millions of POLYX, so whole
      // units are already far below one pixel.
      columns.points.push(entry ? entry.points : null);
      columns.commission.push(entry ? round(entry.op.commission, 4) : null);
      columns.totalStake.push(entry ? Math.round(entry.stake) : null);
      columns.ownStake.push(entry ? round(entry.ownStake, 2) : null);
      columns.nominatorCount.push(entry ? entry.nominatorCount : null);
    }

    operatorSeries[op.address] = columns;
  }

  return {
    from: chunkStart,
    to: chunkStart + CHUNK_SIZE - 1,
    eras: eras as [number, ...number[]],
    eraStart: samples.map((s) => s.eraStart),
    network: {
      totalStaked: samples.map((s) => Math.round(s.totalStaked)),
      totalIssuance: samples.map((s) => Math.round(s.totalIssuance)),
      validatorReward: samples.map((s) => round(s.validatorReward, 3)),
      totalPoints: samples.map((s) => s.totalPoints),
      activeOperators: samples.map((s) => s.active.length),
      nominatorCount: samples.map((s) => s.active.reduce((sum, a) => sum + a.nominatorCount, 0)),
      avgCommission: samples.map((s) => round(s.avgCommission, 5)),
      avgApr: samples.map((s) => round(s.avgApr, 5)),
      aprP10: samples.map((s) => round(s.aprP10, 5)),
      aprP50: samples.map((s) => round(s.aprP50, 5)),
      aprP90: samples.map((s) => round(s.aprP90, 5)),
    },
    operators: operatorSeries,
    provenance: {
      // Synthetic history straddles the v8 upgrade so both exposure shapes are
      // exercised by anything that branches on provenance.
      specVersion: samples.map((s) => (s.era < 1300 ? 7_000_000 : 8_000_000)),
      exposureShape: samples.map((s) => (s.era < 1300 ? 'clipped' : 'paged')),
      source: samples.map(() => 'live'),
    },
  };
}

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

async function writeJson(path: string, value: unknown): Promise<number> {
  const body = JSON.stringify(value);
  await writeFile(path, body, 'utf8');
  return Buffer.byteLength(body);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rng = makeRng(options.seed);

  // Anchor on a fixed date so output is reproducible run to run.
  const anchor = Date.UTC(2026, 7, 8) / 1000;
  const activeEra = 1403;
  const lastCompleteEra = activeEra - 1;
  const firstEra = lastCompleteEra - options.eras + 1;

  const operators = buildOperators(rng, options.operators, firstEra, lastCompleteEra);

  const samples: EraSample[] = [];
  for (let era = firstEra, i = 0; era <= lastCompleteEra; era += 1, i += 1) {
    const eraStart = anchor - (lastCompleteEra - era + 1) * ERA_SECONDS;
    samples.push(simulateEra(rng, era, i, eraStart, operators));
  }

  const outDir = options.outDir;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'chunks'), { recursive: true });

  // --- chunks ---
  const grouped = groupErasByChunk(samples.map((s) => s.era));
  const chunkRefs: ChunkRef[] = [];
  let chunkBytes = 0;

  for (const [chunkStart, eras] of [...grouped].sort((a, b) => a[0] - b[0])) {
    const chunkSamples = samples.filter((s) => eras.includes(s.era));
    const chunk = ChunkSchema.parse(buildChunk(chunkStart, chunkSamples, operators));
    const path = chunkPath(chunkStart);
    chunkBytes += await writeJson(join(outDir, path), chunk);

    chunkRefs.push({
      from: chunk.from,
      to: chunk.to,
      path,
      hash: hashOf(chunk),
      complete: isChunkComplete(chunkStart, eras.length, lastCompleteEra),
    });
  }

  // --- manifest ---
  const manifest = ManifestSchema.parse({
    schemaVersion: 1,
    chain: {
      name: 'Polymesh Mainnet (synthetic)',
      genesisHash: `0x${'00'.repeat(32)}`,
      tokenSymbol: 'POLYX',
      tokenDecimals: TOKEN_DECIMALS,
    },
    generatedAt: new Date(anchor * 1000).toISOString(),
    activeEra,
    firstEra,
    lastCompleteEra,
    erasPerYear: EPY,
    chunkSize: CHUNK_SIZE,
    chunks: chunkRefs,
  });
  await writeJson(join(outDir, 'manifest.json'), manifest);

  // --- operators.json ---
  const registry = OperatorRegistrySchema.parse(
    Object.fromEntries(operators.map((op) => [op.address, op.record])),
  );
  await writeJson(join(outDir, 'operators.json'), registry);

  // --- latest.json ---
  const last = samples.at(-1)!;
  const activeEraStart = anchor;
  const stakingRatio = last.totalStaked / last.totalIssuance;
  const latest = LatestSchema.parse({
    schemaVersion: 1,
    activeEra,
    generatedAt: new Date(anchor * 1000).toISOString(),
    eraStatus: {
      currentEra: activeEra,
      eraStart: activeEraStart,
      eraStartSlot: '284419200',
      eraStartSessionIndex: 8412,
      currentSlot: '284426400',
      currentSessionIndex: 8413,
      epochIndex: 8413,
      genesisSlot: '265680000',
      sessionsPerEra: TIMING.sessionsPerEra,
      epochDurationBlocks: TIMING.epochDurationBlocks,
      expectedBlockTimeMs: TIMING.expectedBlockTimeMs,
      electionPhase: 'Off',
    },
    totalIssuance: (BigInt(Math.round(last.totalIssuance)) * BASE).toString(),
    totalStaked: (BigInt(Math.round(last.totalStaked)) * BASE).toString(),
    stakingRatio: round(stakingRatio),
    inflation: round(FIXED_YEARLY_REWARD / last.totalIssuance),
    impliedApr: round(FIXED_YEARLY_REWARD / last.totalIssuance / stakingRatio),
    validatorCount: {
      active: last.active.length,
      waiting: Math.round(last.active.length * 0.15),
      max: Math.max(120, last.active.length),
    },
    operators: last.active.map((a) => ({
      address: a.op.address,
      // Partway through the active era, so points are lower than a full era's.
      points: Math.round(a.points * 0.42),
      commission: round(a.op.commission),
      totalStake: (BigInt(Math.round(a.stake)) * BASE).toString(),
      ownStake: (BigInt(Math.round(a.ownStake)) * BASE).toString(),
      nominatorCount: a.nominatorCount,
      oversubscribed: a.nominatorCount > 256,
      pageCount: Math.max(1, Math.ceil(a.nominatorCount / 256)),
      blocked: false,
      elected: true,
    })),
  });
  await writeJson(join(outDir, 'latest.json'), latest);

  // --- rollup-weekly.json ---
  const weeks: EraSample[][] = [];
  for (let i = 0; i < samples.length; i += 7) weeks.push(samples.slice(i, i + 7));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

  const rollup = RollupSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date(anchor * 1000).toISOString(),
    weekStart: weeks.map((w) => w[0]!.eraStart),
    eraFrom: weeks.map((w) => w[0]!.era),
    eraTo: weeks.map((w) => w.at(-1)!.era),
    totalStaked: weeks.map((w) => round(avg(w.map((s) => s.totalStaked)), 2)),
    totalIssuance: weeks.map((w) => round(avg(w.map((s) => s.totalIssuance)), 2)),
    validatorReward: weeks.map((w) =>
      round(
        w.reduce((a, s) => a + s.validatorReward, 0),
        2,
      ),
    ),
    totalPoints: weeks.map((w) => Math.round(avg(w.map((s) => s.totalPoints)))),
    avgApr: weeks.map((w) => round(avg(w.map((s) => s.avgApr)))),
    activeOperators: weeks.map((w) => Math.round(avg(w.map((s) => s.active.length)))),
  });
  await writeJson(join(outDir, 'rollup-weekly.json'), rollup);

  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(
    [
      `Synthetic dataset written to ${outDir}`,
      `  eras       ${firstEra}-${lastCompleteEra} (${samples.length}), active ${activeEra}`,
      `  operators  ${operators.length}`,
      `  chunks     ${chunkRefs.length} (${kb(chunkBytes)} raw, ~${kb(chunkBytes / 6)} brotli est.)`,
      `  seed       ${options.seed} — rerun with the same seed for identical output`,
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
