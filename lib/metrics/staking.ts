/**
 * Staking metric derivations.
 *
 * Ported from the previous app's chart components, which had this maths right —
 * it is the most valuable part of that codebase. Three deliberate changes:
 *
 *  1. **Ratios, not percentages.** Everything in [0,1]. The old code mixed the
 *     two (`apr` as a percentage, `commission` as a ratio) and multiplied by
 *     100 at inconsistent points. Formatting is the UI's job.
 *  2. **Pure functions.** The old versions were inlined in `useEffect` bodies
 *     and could not be tested. These take values and return values.
 *  3. **Exact integer apportionment** where the chain uses integer division,
 *     so our per-operator reward matches what was actually paid.
 *
 * Every function here is called by both the pipeline and the client, so none of
 * it may reference chain objects, React, or the DOM.
 */

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** On-chain `Perbill`: a ratio scaled by 1e9. */
const PERBILL = 1_000_000_000;

// ---------------------------------------------------------------------------
// Era timing
// ---------------------------------------------------------------------------

export interface EraTimingConsts {
  /** Target block time in milliseconds. */
  expectedBlockTimeMs: number;
  /** Blocks per epoch (session). */
  epochDurationBlocks: number;
  /** Epochs per era. */
  sessionsPerEra: number;
}

/**
 * Eras per year, derived from chain constants rather than assumed to be 365.
 * On Polymesh mainnet an era is 24 hours so this lands at ~365, but the
 * constants are what the reward maths is defined against and testnets differ.
 */
export function erasPerYear({
  expectedBlockTimeMs,
  epochDurationBlocks,
  sessionsPerEra,
}: EraTimingConsts): number {
  const eraMs = expectedBlockTimeMs * epochDurationBlocks * sessionsPerEra;
  if (eraMs <= 0) throw new RangeError('era duration must be positive');
  return MS_PER_YEAR / eraMs;
}

/** Era duration in milliseconds. */
export function eraDurationMs({
  expectedBlockTimeMs,
  epochDurationBlocks,
  sessionsPerEra,
}: EraTimingConsts): number {
  return expectedBlockTimeMs * epochDurationBlocks * sessionsPerEra;
}

/**
 * Fraction of the active era elapsed, clamped to [0,1].
 *
 * This is the tier-3 derivation (design doc §6.6a): the client calls it against
 * its own clock using anchors from `latest.json`, so a ticking countdown costs
 * no network traffic. Drift between snapshots is bounded by block-time variance
 * over the snapshot interval — seconds on a 24-hour era.
 */
export function eraProgress(
  eraStartSeconds: number,
  nowSeconds: number,
  consts: EraTimingConsts,
): number {
  const durationSeconds = eraDurationMs(consts) / 1000;
  if (durationSeconds <= 0) return 0;
  return clamp01((nowSeconds - eraStartSeconds) / durationSeconds);
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

/** Converts an on-chain Perbill commission to a ratio in [0,1]. */
export function perbillToRatio(perbill: number | bigint): number {
  return Number(perbill) / PERBILL;
}

/** The share of a reward left for nominators after commission. */
export function portionAfterCommission(commission: number): number {
  return 1 - commission;
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/**
 * An operator's gross share of the era reward, apportioned by reward points.
 *
 * Integer arithmetic with truncating division, mirroring the chain. Using
 * floats here would drift from the amount actually paid — small per era, but
 * these are summed across ~1,700 eras on the operator pages.
 *
 * Returns 0 when the era scored no points, which happens on stalled eras.
 */
export function apportionReward(
  eraReward: bigint,
  operatorPoints: bigint,
  totalPoints: bigint,
): bigint {
  if (totalPoints <= 0n) return 0n;
  return (eraReward * operatorPoints) / totalPoints;
}

/**
 * Annualised return for one operator in one era, as a ratio.
 *
 * `net` deducts the operator's commission and is what a nominator earns;
 * `gross` is before commission and reflects node performance rather than the
 * deal on offer. The previous app drew these as two separate charts; here they
 * are one value pair behind a toggle.
 *
 * Returns zeroes when nothing is staked against the operator — an APR on zero
 * stake is undefined, not infinite.
 */
export function operatorApr(params: {
  eraReward: bigint;
  operatorPoints: bigint;
  totalPoints: bigint;
  operatorTotalStake: bigint;
  commission: number;
  erasPerYear: number;
}): { gross: number; net: number } {
  const { eraReward, operatorPoints, totalPoints, operatorTotalStake, commission } = params;
  if (operatorTotalStake <= 0n) return { gross: 0, net: 0 };

  const nodeReward = apportionReward(eraReward, operatorPoints, totalPoints);
  const gross = (Number(nodeReward) / Number(operatorTotalStake)) * params.erasPerYear;

  return { gross, net: gross * portionAfterCommission(commission) };
}

/**
 * Compounds a per-era rate into an annual one.
 *
 * APR treats rewards as withdrawn; APY assumes they are re-staked every era.
 * On Polymesh, reward destination is a user choice, so both are shown and the
 * difference is real money rather than presentation.
 */
export function aprToApy(apr: number, erasPerYear: number): number {
  if (erasPerYear <= 0) return 0;
  return (1 + apr / erasPerYear) ** erasPerYear - 1;
}

// ---------------------------------------------------------------------------
// Network aggregates
// ---------------------------------------------------------------------------

export interface OperatorEraInput {
  address: string;
  points: bigint;
  totalStake: bigint;
  commission: number;
}

/**
 * Points-weighted mean commission for an era.
 *
 * Weighting by points rather than taking a plain mean is the point: a
 * tiny operator charging 100% should not move the network average as much as a
 * large, productive one charging 5%.
 *
 * The weight actually accounted for is tracked and the result normalised over
 * it. An account can score reward points in an era without having a
 * preferences entry — the previous app's fix for a real bug, preserved here.
 */
export function weightedAverageCommission(
  operators: readonly OperatorEraInput[],
  totalPoints: bigint,
): number {
  if (totalPoints <= 0n) return 0;

  let accountedWeight = 0;
  let weighted = 0;

  for (const op of operators) {
    const weight = Number(op.points) / Number(totalPoints);
    accountedWeight += weight;
    weighted += weight * op.commission;
  }

  return accountedWeight > 0 ? weighted / accountedWeight : 0;
}

/**
 * Stake-weighted mean APR after commission across an era.
 *
 * Computed from summed rewards over summed stake rather than as a mean of the
 * per-operator APRs: the latter would weight a 1,000-POLYX operator the same as
 * a 5,000,000-POLYX one and overstate what the network actually paid.
 */
export function networkAverageApr(params: {
  operators: readonly OperatorEraInput[];
  eraReward: bigint;
  totalPoints: bigint;
  erasPerYear: number;
}): number {
  const { operators, eraReward, totalPoints, erasPerYear: epy } = params;

  let stakeSum = 0n;
  let nominatorRewardSum = 0;

  for (const op of operators) {
    if (op.totalStake <= 0n) continue;
    const nodeReward = apportionReward(eraReward, op.points, totalPoints);
    nominatorRewardSum += Number(nodeReward) * portionAfterCommission(op.commission);
    stakeSum += op.totalStake;
  }

  if (stakeSum <= 0n) return 0;
  return (nominatorRewardSum / Number(stakeSum)) * epy;
}

// ---------------------------------------------------------------------------
// Inflation and the reward curve
// ---------------------------------------------------------------------------

/**
 * Polymesh's inflation curve parameters.
 *
 *   Inflation(x) = I0 + (I_ideal - I0) * x / x_ideal                for x <= x_ideal
 *                = I0 + (I_ideal - I0) * 2^((x_ideal - x) / decay)  for x >  x_ideal
 *
 * where x is the fraction of supply staked. Below the ideal, inflation rises to
 * attract stake; above it, it decays to discourage over-staking.
 */
export const REWARD_CURVE = {
  /** Inflation at 0% staked. */
  i0: 0.025,
  /** Staking ratio the curve targets. */
  xIdeal: 0.7,
  /** Inflation at the ideal ratio — the curve's maximum. */
  iIdeal: 0.14,
  /** Decay constant above the ideal ratio. */
  decay: 0.05,
} as const;

/** Uncapped annual inflation at a given staking ratio. */
export function curveInflation(stakingRatio: number): number {
  const { i0, xIdeal, iIdeal, decay } = REWARD_CURVE;
  const x = Math.max(0, stakingRatio);
  return x <= xIdeal
    ? i0 + (iIdeal - i0) * (x / xIdeal)
    : i0 + (iIdeal - i0) * 2 ** ((xIdeal - x) / decay);
}

/**
 * Realised inflation and returns at a staking ratio.
 *
 * Polymesh caps annual issuance at a fixed amount (`fixedYearlyReward`), so
 * actual inflation is the lesser of the curve and that cap. Ignoring the cap —
 * as a naive reading of the curve would — overstates APR whenever supply is
 * large enough for the cap to bind, which is the regime the network is in.
 */
export function stakingReturns(params: {
  stakingRatio: number;
  totalIssuance: bigint;
  fixedYearlyReward: bigint;
  erasPerYear: number;
}): { inflation: number; apr: number; apy: number } {
  const { stakingRatio, totalIssuance, fixedYearlyReward, erasPerYear: epy } = params;

  if (stakingRatio <= 0 || totalIssuance <= 0n) return { inflation: 0, apr: 0, apy: 0 };

  const maxInflation = Number(fixedYearlyReward) / Number(totalIssuance);
  const inflation = Math.min(curveInflation(stakingRatio), maxInflation);
  const apr = inflation / stakingRatio;

  return { inflation, apr, apy: aprToApy(apr, epy) };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts base units to POLYX. Used at the boundary where exact balances
 * become chart values — never in the middle of a calculation.
 */
export function toPolyx(baseUnits: bigint, tokenDecimals: number): number {
  const divisor = 10 ** tokenDecimals;
  return Number(baseUnits) / divisor;
}
