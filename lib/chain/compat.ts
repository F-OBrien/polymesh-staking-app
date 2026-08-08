/* eslint-disable @typescript-eslint/no-explicit-any -- see the note below. */

/**
 * Chain compatibility layer — the *only* place in this codebase permitted to
 * reach into loosely-typed Polkadot storage.
 *
 * Polymesh's staking storage has changed shape three times, and the generated
 * type augmentations only describe the current runtime. Reading historical eras
 * therefore means touching entries the types say do not exist. Rather than
 * scatter ~30 `@ts-ignore`s across the app — which is what the previous version
 * did, several of them hiding real drift — every such access is quarantined
 * here, behind functions with honest signatures.
 *
 * What changed, and when:
 *
 *  - **v6 → v7**: `historyDepth` moved from a storage item to a constant.
 *  - **v7 → v8**: exposures moved from a single clipped entry per operator
 *    (`erasStakersClipped`) to an overview plus paged nominators
 *    (`erasStakersOverview` + `erasStakersPaged`). Eras recorded before the
 *    upgrade only have the clipped form, so this varies *per era*, not per
 *    chain — which is why `readEraExposures` probes rather than branching on a
 *    single chain-wide flag.
 *  - **v7 → v8**: `fixedYearlyReward` and `maxVariableInflationTotalIssuance`
 *    moved from the `staking` pallet to `validators`.
 *  - **v8**: nomination events moved to the `validators` pallet.
 *
 * `ApiLike` is deliberately `any`-shaped: importing `@polkadot/api` types here
 * would pull the package into the module graph, and the whole performance
 * argument depends on it staying out (enforced by the lint rule in
 * eslint.config.mjs). Callers are the ingestion scripts, which run in Node.
 */

import type { ExposureShape } from '@/lib/schemas/data';

/** A `@polkadot/api` `ApiPromise`, or one returned by `api.at(blockHash)`. */
export type ApiLike = any;

export interface EraExposure {
  address: string;
  /** Total stake backing the operator, in base units. */
  total: bigint;
  /** The operator's own stake, in base units. */
  own: bigint;
  nominatorCount: number;
}

export interface EraExposures {
  shape: ExposureShape;
  exposures: EraExposure[];
}

const toBigInt = (value: unknown): bigint => BigInt(value?.toString() ?? '0');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of past eras the chain retains in state.
 *
 * A constant since v7; a storage item before that. Both are tried because a
 * backfill reads historical blocks where only the older form exists.
 */
export async function readHistoryDepth(api: ApiLike): Promise<number> {
  const asConst = api.consts.staking?.historyDepth;
  if (asConst != null) return Number(asConst.toString());

  const asStorage = await api.query.staking.historyDepth();
  return Number(asStorage.toString());
}

export interface InflationConsts {
  fixedYearlyReward: bigint;
  maxVariableInflationTotalIssuance: bigint;
}

/**
 * Inflation caps. Moved from `staking` to `validators` in v8; the augmented
 * types describe only the v8 location, so the v6/v7 fallback is untyped.
 */
export function readInflationConsts(api: ApiLike): InflationConsts {
  const validators = api.consts.validators;
  const staking = api.consts.staking;

  const fixedYearlyReward = validators?.fixedYearlyReward ?? staking?.fixedYearlyReward;
  const maxVariable =
    validators?.maxVariableInflationTotalIssuance ?? staking?.maxVariableInflationTotalIssuance;

  if (fixedYearlyReward == null || maxVariable == null) {
    throw new Error(
      'Inflation constants not found in either the `validators` or `staking` pallet. ' +
        'The runtime may have moved them again — check the chain version.',
    );
  }

  return {
    fixedYearlyReward: toBigInt(fixedYearlyReward),
    maxVariableInflationTotalIssuance: toBigInt(maxVariable),
  };
}

export interface EraTimingConstsRaw {
  expectedBlockTimeMs: number;
  epochDurationBlocks: number;
  sessionsPerEra: number;
}

export function readEraTimingConsts(api: ApiLike): EraTimingConstsRaw {
  return {
    expectedBlockTimeMs: Number(api.consts.babe.expectedBlockTime.toString()),
    epochDurationBlocks: Number(api.consts.babe.epochDuration.toString()),
    sessionsPerEra: Number(api.consts.staking.sessionsPerEra.toString()),
  };
}

// ---------------------------------------------------------------------------
// Per-era storage
// ---------------------------------------------------------------------------

/** Total reward points for the era, and each operator's share. */
export async function readEraRewardPoints(
  api: ApiLike,
  era: number,
): Promise<{ total: bigint; operators: Map<string, bigint> }> {
  const result = await api.query.staking.erasRewardPoints(era);
  const operators = new Map<string, bigint>();

  result.individual.forEach((points: unknown, operator: unknown) => {
    operators.set(String(operator), toBigInt(points));
  });

  return { total: toBigInt(result.total), operators };
}

/** The era's total validator payout, in base units. Zero for unfinished eras. */
export async function readEraReward(api: ApiLike, era: number): Promise<bigint> {
  const result = await api.query.staking.erasValidatorReward(era);
  return result.isSome ? toBigInt(result.unwrap()) : 0n;
}

export async function readEraTotalStake(api: ApiLike, era: number): Promise<bigint> {
  return toBigInt(await api.query.staking.erasTotalStake(era));
}

/** Commission per operator for the era, as a ratio in [0,1]. */
export async function readEraPreferences(
  api: ApiLike,
  era: number,
): Promise<Map<string, { commission: number; blocked: boolean }>> {
  const entries = await api.query.staking.erasValidatorPrefs.entries(era);
  const out = new Map<string, { commission: number; blocked: boolean }>();

  for (const [key, prefs] of entries) {
    const address = String(key.args[1]);
    out.set(address, {
      // Perbill: scaled by 1e9.
      commission: Number(prefs.commission.toString()) / 1_000_000_000,
      blocked: Boolean(prefs.blocked?.isTrue ?? prefs.blocked?.valueOf?.() ?? false),
    });
  }

  return out;
}

/**
 * Operator exposures for an era, in whichever shape that era was recorded.
 *
 * Tries the v8 paged form first and falls back to the v6/v7 clipped form. The
 * probe is per era rather than per chain because a v8 node still holds
 * pre-upgrade eras in the old shape — branching on the runtime version alone
 * would silently return nothing for those eras.
 */
export async function readEraExposures(api: ApiLike, era: number): Promise<EraExposures> {
  if ('erasStakersPaged' in api.query.staking) {
    const paged = await readPagedExposures(api, era);
    if (paged.length > 0) return { shape: 'paged', exposures: paged };
  }
  return { shape: 'clipped', exposures: await readClippedExposures(api, era) };
}

/** v6/v7: one clipped exposure per operator, nominators inline. */
async function readClippedExposures(api: ApiLike, era: number): Promise<EraExposure[]> {
  const entries = await api.query.staking.erasStakersClipped.entries(era);

  return entries.map(([key, exposure]: [any, any]) => ({
    address: String(key.args[1]),
    total: toBigInt(exposure.total),
    own: toBigInt(exposure.own),
    nominatorCount: exposure.others.length,
  }));
}

/**
 * v8: an overview holding the totals, plus nominators split across pages.
 *
 * Both are read with a partial (era-only) key, so this stays at two queries per
 * era rather than one per operator — the difference between a bearable backfill
 * and an abusive one.
 *
 * Only nominator *counts* are kept. Full nominator lists are an order of
 * magnitude more data and are needed on exactly one screen, so they are fetched
 * on demand rather than baked into every chunk.
 */
async function readPagedExposures(api: ApiLike, era: number): Promise<EraExposure[]> {
  const [overviews, pages] = await Promise.all([
    api.query.staking.erasStakersOverview.entries(era),
    api.query.staking.erasStakersPaged.entries(era),
  ]);

  const nominatorsByOperator = new Map<string, number>();
  for (const [key, page] of pages) {
    if (page.isNone) continue;
    const address = String(key.args[1]);
    const count = page.unwrap().others.length;
    nominatorsByOperator.set(address, (nominatorsByOperator.get(address) ?? 0) + count);
  }

  const exposures: EraExposure[] = [];
  for (const [key, overview] of overviews) {
    if (overview.isNone) continue;
    const address = String(key.args[1]);
    const { total, own } = overview.unwrap();
    exposures.push({
      address,
      total: toBigInt(total),
      own: toBigInt(own),
      nominatorCount: nominatorsByOperator.get(address) ?? 0,
    });
  }

  return exposures;
}

// ---------------------------------------------------------------------------
// Chain head and era boundaries
// ---------------------------------------------------------------------------

export interface EraSlash {
  address: string;
  /** Proportion of exposure slashed, in [0,1]. */
  fraction: number;
  /** The operator's own loss, in base units. */
  amount: bigint;
}

/**
 * Operators slashed for offences committed in `era`.
 *
 * One `entries()` call per era rather than a lookup per (era, operator): the
 * double map is prefixed by era, so this is a single range read regardless of
 * how many operators the era had.
 *
 * **Pruned to history depth.** `validatorSlashInEra` is cleared along with the
 * rest of an era's staking state, so an empty result for an old era means "we
 * can no longer tell", not "nothing happened". Callers must carry that
 * distinction through to the UI — `SlashesSchema.prunedBefore` exists for it.
 *
 * The map is absent on old runtimes, so a missing entry is not an error.
 */
export async function readEraSlashes(api: ApiLike, era: number): Promise<EraSlash[]> {
  const store = api.query.staking?.validatorSlashInEra;
  if (store == null) return [];

  const entries = await store.entries(era);
  const slashes: EraSlash[] = [];

  for (const [key, value] of entries) {
    if (!value?.isSome) continue;
    // (Perbill, Balance) — the fraction of exposure, and the operator's own loss.
    const [perbill, amount] = value.unwrap();
    slashes.push({
      address: String(key.args[1]),
      fraction: Number(perbill.toString()) / 1_000_000_000,
      amount: toBigInt(amount),
    });
  }

  return slashes;
}

/**
 * Nominator losses for offences committed in `era`, aggregated.
 *
 * Returned as a count and a total rather than a list because the storage is
 * keyed by (era, nominator) with **no back-reference to the operator
 * responsible**. Per-nominator rows would therefore be unattributable, and
 * there can be thousands of them. The aggregate is the most that can be said
 * honestly, and it is small.
 */
export async function readEraNominatorSlashes(
  api: ApiLike,
  era: number,
): Promise<{ count: number; total: bigint }> {
  const store = api.query.staking?.nominatorSlashInEra;
  if (store == null) return { count: 0, total: 0n };

  const entries = await store.entries(era);
  let count = 0;
  let total = 0n;

  for (const [, value] of entries) {
    if (!value?.isSome) continue;
    count += 1;
    total += toBigInt(value.unwrap());
  }

  return { count, total };
}

export interface ActiveEraInfo {
  index: number;
  /** Milliseconds since epoch, or null on a chain that has not set it. */
  startMs: number | null;
}

export async function readActiveEra(api: ApiLike): Promise<ActiveEraInfo> {
  const result = await api.query.staking.activeEra();
  if (result.isNone) throw new Error('Chain reports no active era');

  const info = result.unwrap();
  return {
    index: Number(info.index.toString()),
    startMs: info.start.isSome ? Number(info.start.unwrap().toString()) : null,
  };
}

export async function readCurrentEra(api: ApiLike): Promise<number> {
  const result = await api.query.staking.currentEra();
  return result.isSome ? Number(result.unwrap().toString()) : 0;
}

/** Session index an era began at. Used to derive slot-exact era progress. */
export async function readEraStartSessionIndex(api: ApiLike, era: number): Promise<number | null> {
  const result = await api.query.staking.erasStartSessionIndex(era);
  return result.isSome ? Number(result.unwrap().toString()) : null;
}

export interface SlotInfo {
  currentSlot: bigint;
  genesisSlot: bigint;
  epochIndex: bigint;
  currentSessionIndex: number;
}

export async function readSlotInfo(api: ApiLike): Promise<SlotInfo> {
  const [currentSlot, genesisSlot, epochIndex, sessionIndex] = await Promise.all([
    api.query.babe.currentSlot(),
    api.query.babe.genesisSlot(),
    api.query.babe.epochIndex(),
    api.query.session.currentIndex(),
  ]);

  return {
    currentSlot: toBigInt(currentSlot),
    genesisSlot: toBigInt(genesisSlot),
    epochIndex: toBigInt(epochIndex),
    currentSessionIndex: Number(sessionIndex.toString()),
  };
}

export type ElectionPhase = 'Off' | 'Signed' | 'Unsigned' | 'Emergency';

/**
 * Current election phase. Absent on runtimes without
 * `electionProviderMultiPhase`, in which case 'Off' is the honest answer —
 * there is no multi-phase election to be in.
 */
export async function readElectionPhase(api: ApiLike): Promise<ElectionPhase> {
  const pallet = api.query.electionProviderMultiPhase;
  if (pallet?.currentPhase == null) return 'Off';

  const phase = await pallet.currentPhase();
  if (phase.isSigned) return 'Signed';
  if (phase.isUnsigned) return 'Unsigned';
  if (phase.isEmergency) return 'Emergency';
  return 'Off';
}

export async function readTotalIssuance(api: ApiLike): Promise<bigint> {
  return toBigInt(await api.query.balances.totalIssuance());
}

export interface ValidatorSet {
  /** Operators elected for the active era. */
  active: string[];
  /** Operators declaring intent but not elected. */
  waiting: string[];
  max: number;
}

export async function readValidatorSet(api: ApiLike): Promise<ValidatorSet> {
  const [sessionValidators, intentions, validatorCount] = await Promise.all([
    api.query.session.validators(),
    api.query.staking.validators.entries(),
    api.query.staking.validatorCount(),
  ]);

  const active = sessionValidators.map((v: unknown) => String(v));
  const activeSet = new Set(active);
  const waiting = intentions
    .map(([key]: [any]) => String(key.args[0]))
    .filter((address: string) => !activeSet.has(address));

  return { active, waiting, max: Number(validatorCount.toString()) };
}

/**
 * Maximum nominators rewarded per exposure page.
 *
 * Nominators beyond this earn nothing, so it is the difference between staking
 * and only appearing to stake. Absent on pre-v8 runtimes.
 */
export function readMaxExposurePageSize(api: ApiLike): number | null {
  const value = api.consts.staking?.maxExposurePageSize;
  return value == null ? null : Number(value.toString());
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Resolves a stash account to its Polymesh identity (DID).
 *
 * This is the join that makes the official operator-name registry usable: that
 * file is keyed by DID, while everything in staking is keyed by stash address.
 *
 * The storage item was renamed between runtimes (`keyToIdentityIds` ->
 * `keyRecords`), and the newer one wraps the DID in an enum with a variant per
 * key type. An unresolvable account returns null rather than throwing, because
 * a validator with no registered identity is normal and must not fail a run.
 *
 * Every candidate is checked against `isDid` before being returned. That guard
 * is not defensive padding — it caught a real bug: `SecondaryKey` was assumed
 * to hold a `(did, permissions)` tuple, so indexing `[0]` sliced characters out
 * of the DID string and produced `"226"`. A malformed value reaching the
 * registry would have failed the whole ingest over a display name.
 */
const DID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function isDid(value: unknown): value is string {
  return typeof value === 'string' && DID_PATTERN.test(value);
}

/**
 * Coerces a codec to a DID string.
 *
 * Accepts either the value itself or a tuple whose first element is the DID,
 * since variants have differed on that point across runtimes.
 */
function toDid(candidate: unknown): string | null {
  if (candidate == null) return null;

  const direct = String(candidate);
  if (isDid(direct)) return direct;

  // polkadot-js tuples extend Array, so this distinguishes a real tuple from a
  // plain H256 (a Uint8Array subclass, for which Array.isArray is false).
  if (Array.isArray(candidate) && candidate.length > 0) {
    const first = String(candidate[0]);
    if (isDid(first)) return first;
  }

  return null;
}

export async function readIdentityForAccount(
  api: ApiLike,
  address: string,
): Promise<string | null> {
  const identity = api.query.identity;

  if (identity?.keyRecords != null) {
    const record = await identity.keyRecords(address);
    if (record.isNone) return null;

    const value = record.unwrap();
    if (value.isPrimaryKey) return toDid(value.asPrimaryKey);
    if (value.isSecondaryKey) return toDid(value.asSecondaryKey);
    // `MultiSigSignerKey` and any future variant: no owning identity to report.
    return null;
  }

  if (identity?.keyToIdentityIds != null) {
    const did = await identity.keyToIdentityIds(address);
    return did.isNone ? null : toDid(did.unwrap());
  }

  return null;
}
