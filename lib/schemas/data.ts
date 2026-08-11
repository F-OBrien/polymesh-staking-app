import { z } from 'zod';

/**
 * The data contract (design doc §6.4). One definition, used by the pipeline
 * that writes these files and the client that reads them — so a shape change
 * cannot drift between the two.
 *
 * Two conventions matter and are easy to get wrong:
 *
 *  - **Balances in chunks are POLYX as `number`** (base units / 10^6, 6 dp).
 *    Chart-precise and far smaller on the wire.
 *  - **Balances in `latest.json` are exact base-unit strings.** Anything a user
 *    might reconcile against a block explorer keeps full precision.
 *
 * Never mix them. `PolyxAmount` and `BaseUnits` below make the distinction
 * visible at every use site.
 */

/** POLYX, already divided by 10^tokenDecimals. Display and charting only. */
const PolyxAmount = z.number().finite();

/** Exact balance in base units, as a decimal string. Never a JS number. */
const BaseUnits = z.string().regex(/^\d+$/, 'expected an unsigned integer string');

/** A ratio in [0,1] — commission, APR, staking ratio. Never a percentage. */
const Ratio = z.number().min(0);

const EraIndex = z.number().int().nonnegative();
const UnixSeconds = z.number().int().nonnegative();

/** SS58 address. Length varies with the value being encoded, so this is loose. */
const Address = z.string().min(32).max(64);

/** Polymesh identity, a 0x-prefixed 32-byte hash. */
const Did = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 0x-prefixed 32-byte DID');

/**
 * A column of per-era values. `null` means the operator was not in the active
 * set that era — distinct from zero, which means they were and scored nothing.
 * Conflating the two would drag every average down.
 */
const NullableNumberColumn = z.array(z.number().nullable());

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * How an era's data reached us. `source` exists so a backfill that later proves
 * subtly wrong can be dropped by exactly the eras it wrote, leaving natively
 * ingested history untouched (design doc §6.5).
 */
export const EraSourceSchema = z.enum(['live', 'backfill-archive', 'backfill-indexer']);

/**
 * Exposure storage shape. Polymesh v8 replaced a single clipped exposure per
 * operator with an overview plus paged nominators; eras recorded before the
 * upgrade only have the clipped form, so this varies per era, not per chain.
 */
export const ExposureShapeSchema = z.enum(['clipped', 'paged']);

export const ProvenanceSchema = z.object({
  specVersion: z.array(z.number().int().nonnegative()),
  exposureShape: z.array(ExposureShapeSchema),
  source: z.array(EraSourceSchema),
});

// ---------------------------------------------------------------------------
// Chunks — immutable once complete
// ---------------------------------------------------------------------------

/**
 * Per-operator series within a chunk. Every column is the same length as the
 * chunk's `eras` array and is indexed by position, which is what keeps the file
 * small: no repeated keys, no per-era objects.
 *
 * **Chain facts only — nothing derived.** An earlier revision also stored
 * `reward`, `apr` and `aprGross`, but all three are computable from these
 * columns plus `network.validatorReward` and `network.totalPoints`. Storing
 * them cost 37% of the payload (measured: 259 KB vs 120 KB budget for a 90-era
 * window) and, worse, created a second definition of APR that could drift from
 * `lib/metrics/staking.ts`. Derive them via `lib/metrics/derive.ts` instead.
 */
export const OperatorSeriesSchema = z.object({
  points: NullableNumberColumn,
  /** Commission as a ratio in [0,1]. On chain this is a Perbill (scaled 1e9). */
  commission: NullableNumberColumn,
  totalStake: NullableNumberColumn,
  ownStake: NullableNumberColumn,
  nominatorCount: NullableNumberColumn,
});

export const NetworkSeriesSchema = z.object({
  totalStaked: z.array(PolyxAmount),
  totalIssuance: z.array(PolyxAmount),
  validatorReward: z.array(PolyxAmount),
  totalPoints: z.array(z.number()),
  activeOperators: z.array(z.number().int().nonnegative()),
  nominatorCount: z.array(z.number().int().nonnegative()),
  /** Points-weighted mean commission — not a plain mean. See lib/metrics. */
  avgCommission: z.array(Ratio),
  /** Stake-weighted mean APR after commission. */
  avgApr: z.array(Ratio),
  aprP10: z.array(Ratio),
  aprP50: z.array(Ratio),
  aprP90: z.array(Ratio),
});

export const ChunkSchema = z
  .object({
    from: EraIndex,
    to: EraIndex,
    eras: z.array(EraIndex).nonempty(),
    /** Start timestamp of each era, aligned with `eras`. */
    eraStart: z.array(UnixSeconds),
    network: NetworkSeriesSchema,
    operators: z.record(Address, OperatorSeriesSchema),
    provenance: ProvenanceSchema,
  })
  .refine((c) => c.from <= c.to, { message: '`from` must not exceed `to`' })
  .refine((c) => c.eras.length === c.eraStart.length, {
    message: '`eraStart` must align with `eras`',
  })
  .refine((c) => c.eras.every((e, i) => i === 0 || e > c.eras[i - 1]!), {
    message: '`eras` must be strictly ascending',
  })
  .refine(
    (c) =>
      Object.values(c.network).every((col) => col.length === c.eras.length) &&
      Object.values(c.operators).every((op) =>
        Object.values(op).every((col) => col.length === c.eras.length),
      ) &&
      Object.values(c.provenance).every((col) => col.length === c.eras.length),
    { message: 'every column must be the same length as `eras`' },
  );

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const ChunkRefSchema = z.object({
  from: EraIndex,
  to: EraIndex,
  path: z.string(),
  /** Content hash. Doubles as the IndexedDB cache key on the client. */
  hash: z.string().min(8),
  /**
   * A complete chunk is frozen forever and served immutable. The trailing
   * chunk is incomplete and must not be cached hard.
   */
  complete: z.boolean(),
});

export const ChainInfoSchema = z.object({
  name: z.string(),
  genesisHash: z.string(),
  tokenSymbol: z.string(),
  tokenDecimals: z.number().int().positive(),
});

export const ManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    chain: ChainInfoSchema,
    generatedAt: z.iso.datetime(),
    activeEra: EraIndex,
    firstEra: EraIndex,
    lastCompleteEra: EraIndex,
    /** Derived from chain constants, not assumed to be 365. */
    erasPerYear: z.number().positive(),
    chunkSize: z.number().int().positive(),
    chunks: z.array(ChunkRefSchema),
  })
  .refine((m) => m.firstEra <= m.lastCompleteEra, {
    message: '`firstEra` must not exceed `lastCompleteEra`',
  });

// ---------------------------------------------------------------------------
// latest.json — the 15-minute snapshot
// ---------------------------------------------------------------------------

/**
 * Anchors the client derives era/epoch progress from, against its own clock
 * (design doc §6.6a). There is deliberately no `eraProgress` field: a
 * precomputed progress value is stale the moment it is written, and shipping
 * one would invite the UI to display it rather than derive.
 */
export const EraStatusSchema = z.object({
  currentEra: EraIndex,
  eraStart: UnixSeconds,
  eraStartSlot: z.string(),
  eraStartSessionIndex: z.number().int().nonnegative(),
  currentSlot: z.string(),
  currentSessionIndex: z.number().int().nonnegative(),
  epochIndex: z.number().int().nonnegative(),
  genesisSlot: z.string(),
  sessionsPerEra: z.number().int().positive(),
  epochDurationBlocks: z.number().int().positive(),
  expectedBlockTimeMs: z.number().int().positive(),
  electionPhase: z.enum(['Off', 'Signed', 'Unsigned', 'Emergency']),
});

export const LatestOperatorSchema = z.object({
  address: Address,
  points: z.number().nonnegative(),
  commission: Ratio,
  totalStake: BaseUnits,
  ownStake: BaseUnits,
  nominatorCount: z.number().int().nonnegative(),
  /**
   * How many exposure pages the operator's backers were split across.
   *
   * A payout mechanic, and deliberately *not* a warning. There was an
   * `oversubscribed` flag here that badged any operator with more than
   * `maxExposurePageSize` (64) nominators as "full", claiming new nominators
   * might earn nothing. That is the pre-paged-exposure rule and it is wrong on
   * Polymesh: every page is rewarded, the runtime has a test named
   * `test_nominators_over_max_exposure_page_size_are_rewarded`, and the chain
   * pays each page automatically via `validators::payouts()` rather than
   * waiting for someone to call `payout_stakers`. Verified on mainnet — see
   * `npm run probe:payouts`, which confirms every page of every multi-page
   * operator was claimed. Page count has no consequence for a nominator, so
   * nothing in the UI treats it as one.
   */
  pageCount: z.number().int().nonnegative(),
  /** Operator has blocked further nominations. */
  blocked: z.boolean(),
  elected: z.boolean(),
});

export const LatestSchema = z.object({
  schemaVersion: z.literal(1),
  activeEra: EraIndex,
  /** Surfaced in the UI as "as of HH:MM"; never let a snapshot look live. */
  generatedAt: z.iso.datetime(),
  eraStatus: EraStatusSchema,
  totalIssuance: BaseUnits,
  totalStaked: BaseUnits,
  stakingRatio: Ratio,
  inflation: Ratio,
  impliedApr: Ratio,
  validatorCount: z.object({
    active: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  operators: z.array(LatestOperatorSchema),
});

// ---------------------------------------------------------------------------
// Operator registry
// ---------------------------------------------------------------------------

export const OperatorStatusSchema = z.enum(['active', 'waiting', 'inactive']);

export const OperatorRecordSchema = z.object({
  /** Absent when the stash has no resolvable identity. */
  did: Did.nullable(),
  /** From the official registry, else a truncated address. */
  name: z.string(),
  /** Disambiguates several nodes under one identity, e.g. "Assetera 1". */
  nodeLabel: z.string(),
  website: z.string().nullable(),
  firstSeenEra: EraIndex,
  lastSeenEra: EraIndex,
  status: OperatorStatusSchema,
});

export const OperatorRegistrySchema = z.record(Address, OperatorRecordSchema);

/**
 * The upstream registry maintained by the Polymesh Association, keyed by DID.
 * Fetched by the pipeline and baked into our own registry so the client makes
 * no extra request and we hold a snapshot if the file ever moves.
 */
export const UpstreamOperatorNamesSchema = z.record(z.string(), z.object({ name: z.string() }));

// ---------------------------------------------------------------------------
// slashes.json — offences, within whatever window the chain still holds
// ---------------------------------------------------------------------------

/**
 * One operator slashed in one era.
 *
 * **The offence type is deliberately absent.** `validatorSlashInEra` records
 * only the fraction and the amount; which offence caused it lives in the
 * `offences` pallet's events, not in queryable state. Inferring a type from the
 * fraction is tempting — 7% looks like unresponsiveness — but the fractions
 * overlap, and a plausible-looking wrong label on a page about operator
 * misconduct is worse than no label. Phase 7's indexer client can supply the
 * real type; until then the column does not exist.
 */
export const SlashEventSchema = z.object({
  era: EraIndex,
  address: Address,
  /** Proportion of exposure slashed, in [0,1]. A Perbill on chain. */
  fraction: Ratio,
  /** The operator's own loss, in POLYX. */
  amount: PolyxAmount,
});

/**
 * Per-era nominator slash totals.
 *
 * Kept separate from `events` because `nominatorSlashInEra` is keyed by
 * (era, nominator) and carries no back-reference to the operator responsible.
 * The count and total are therefore honest at era granularity and cannot be
 * attributed per operator — presenting them inside an operator's row would
 * imply an attribution the chain does not give us.
 */
export const NominatorSlashTotalSchema = z.object({
  era: EraIndex,
  count: z.number().int().nonnegative(),
  amount: PolyxAmount,
});

/**
 * Who slashing applies to, read from `validators.slashingAllowedFor`.
 *
 * Polymesh gates nominator slashing behind a runtime switch, and mainnet has it
 * set to `Validator` — only an operator's own stake is at risk. This is
 * governance-changeable, so it is read per run rather than assumed; a page that
 * told nominators they were safe would become wrong the day it flipped.
 *
 * `null` when the chain does not expose the switch at all.
 */
export const SlashingScopeSchema = z.enum(['None', 'Validator', 'ValidatorAndNominator']);

export const SlashesSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    scope: SlashingScopeSchema.nullable(),
    /**
     * The window actually scanned. Slash storage is pruned to the chain's
     * history depth (~84 eras), so absence of an event outside this window is
     * not evidence that none occurred — the UI must say so rather than render
     * an empty table that reads as "never slashed".
     */
    firstEra: EraIndex,
    lastEra: EraIndex,
    /** Set when the window is limited by pruning rather than by our ingestion. */
    prunedBefore: EraIndex.nullable(),
    events: z.array(SlashEventSchema),
    nominatorTotals: z.array(NominatorSlashTotalSchema),
  })
  .refine((s) => s.firstEra <= s.lastEra, {
    message: '`firstEra` must not exceed `lastEra`',
  })
  .refine((s) => s.events.every((e) => e.era >= s.firstEra && e.era <= s.lastEra), {
    message: 'every event must fall inside the scanned window',
  });

// ---------------------------------------------------------------------------
// Weekly rollup — network metrics over all history
// ---------------------------------------------------------------------------

/**
 * Long-range overview charts read this instead of chunks. No per-operator
 * arrays, so it stays small even at ~1,700 eras (design doc §6.5a).
 */
export const RollupSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  /** Start of each week, aligned with the columns below. */
  weekStart: z.array(UnixSeconds),
  eraFrom: z.array(EraIndex),
  eraTo: z.array(EraIndex),
  totalStaked: z.array(PolyxAmount),
  totalIssuance: z.array(PolyxAmount),
  validatorReward: z.array(PolyxAmount),
  totalPoints: z.array(z.number()),
  avgApr: z.array(Ratio),
  activeOperators: z.array(z.number()),
});

// ---------------------------------------------------------------------------
// Inferred types — always derive from the schema, never hand-write alongside
// ---------------------------------------------------------------------------

export type EraSource = z.infer<typeof EraSourceSchema>;
export type ExposureShape = z.infer<typeof ExposureShapeSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type OperatorSeries = z.infer<typeof OperatorSeriesSchema>;
export type NetworkSeries = z.infer<typeof NetworkSeriesSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type ChunkRef = z.infer<typeof ChunkRefSchema>;
export type ChainInfo = z.infer<typeof ChainInfoSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type EraStatus = z.infer<typeof EraStatusSchema>;
export type LatestOperator = z.infer<typeof LatestOperatorSchema>;
export type Latest = z.infer<typeof LatestSchema>;
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>;
export type OperatorRecord = z.infer<typeof OperatorRecordSchema>;
export type OperatorRegistry = z.infer<typeof OperatorRegistrySchema>;
export type Rollup = z.infer<typeof RollupSchema>;
export type SlashEvent = z.infer<typeof SlashEventSchema>;
export type NominatorSlashTotal = z.infer<typeof NominatorSlashTotalSchema>;
export type SlashingScope = z.infer<typeof SlashingScopeSchema>;
export type Slashes = z.infer<typeof SlashesSchema>;
