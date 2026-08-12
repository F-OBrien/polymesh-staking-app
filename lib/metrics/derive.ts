import type { Chunk, NetworkSeries, OperatorSeries } from '@/lib/schemas/data';

/**
 * Network columns as a *stitched* range supplies them.
 *
 * A stored chunk always has a value for every era it lists, so the schema is
 * non-nullable. A stitched range can span an era no chunk covers, which must
 * carry null rather than be dropped — see `StitchedSeries.eras`. Every
 * function here already treats a missing value as a gap; this only makes the
 * signature admit what the caller actually holds.
 */
export type NullableNetwork<K extends keyof NetworkSeries> = {
  [P in K]: readonly (number | null)[];
};
import { aprToApy, apportionReward, portionAfterCommission } from './staking';

/**
 * Derivations over chunk data.
 *
 * Chunks store chain facts only (see `OperatorSeriesSchema`); everything a
 * chart actually plots — an operator's reward, its APR gross and net — is
 * computed here. That keeps one definition of each formula, shared by the
 * pipeline's aggregates and the client's series, and it removed 37% of the
 * chunk payload.
 *
 * All functions are pure, index-aligned, and return `null` wherever the inputs
 * are absent, so a caller can hand the result straight to a chart without
 * checking for gaps first.
 */

/** Balances arrive as POLYX; scaling to integers keeps apportionment exact. */
const REWARD_SCALE = 1_000_000n;

function toScaledBigInt(polyx: number): bigint {
  return BigInt(Math.round(polyx * Number(REWARD_SCALE)));
}

/**
 * An operator's gross reward per era, in POLYX.
 *
 * Apportioned by reward points with the same truncating integer division the
 * chain uses, so a total summed across many eras matches what was really paid
 * rather than accumulating rounding drift.
 */
export function deriveOperatorRewards(
  operator: Pick<OperatorSeries, 'points'>,
  network: NullableNetwork<'validatorReward' | 'totalPoints'>,
): (number | null)[] {
  return operator.points.map((points, i) => {
    const eraReward = network.validatorReward[i];
    const totalPoints = network.totalPoints[i];
    if (points == null || eraReward == null || totalPoints == null || totalPoints <= 0) {
      return null;
    }
    const scaled = apportionReward(
      toScaledBigInt(eraReward),
      BigInt(Math.round(points)),
      BigInt(Math.round(totalPoints)),
    );
    return Number(scaled) / Number(REWARD_SCALE);
  });
}

export interface DerivedApr {
  /** Before commission — reflects node performance, not the deal on offer. */
  gross: (number | null)[];
  /** After commission — what a nominator actually earns. */
  net: (number | null)[];
}

/**
 * Annualised return per era for one operator, as ratios.
 *
 * The previous app drew gross and net as two separate charts; here they are one
 * pair behind a toggle, which is also why they are computed together.
 */
export function deriveOperatorApr(
  operator: OperatorSeries,
  network: NullableNetwork<'validatorReward' | 'totalPoints'>,
  erasPerYear: number,
): DerivedApr {
  const rewards = deriveOperatorRewards(operator, network);

  const gross: (number | null)[] = [];
  const net: (number | null)[] = [];

  for (const [i, reward] of rewards.entries()) {
    const stake = operator.totalStake[i];
    const commission = operator.commission[i];

    if (reward == null || stake == null || stake <= 0) {
      gross.push(null);
      net.push(null);
      continue;
    }

    const g = (reward / stake) * erasPerYear;
    gross.push(g);
    // A missing commission entry means the operator scored points without a
    // preferences record for that era. Treating it as zero would overstate the
    // nominator's return, so the net figure is withheld instead.
    net.push(commission == null ? null : g * portionAfterCommission(commission));
  }

  return { gross, net };
}

/** A single return figure on both commission bases. */
export interface AprPoint {
  /** Before commission — node performance, not the deal on offer. */
  gross: number | null;
  /** After commission — what a nominator actually earns. */
  net: number | null;
}

export const NO_APR: AprPoint = { gross: null, net: null };

export interface EraEstimateInput {
  /** Points this operator has scored so far in the era now running. */
  points: number | null;
  /** Points scored so far this era across every operator. */
  totalPoints: number | null;
  /** This operator's total exposure this era, in POLYX. */
  totalStake: number | null;
  /** 0–1, or null when the preferences record is missing. */
  commission: number | null;
  /** Annual inflation as a ratio, from the reward curve. */
  inflation: number;
  /** Total issuance, in POLYX. */
  totalIssuance: number;
}

/**
 * Forward-looking return for the era **now in progress**.
 *
 * Every other return figure on the site looks backwards. This one answers the
 * question a nominator actually has — *what am I likely to earn next* — and it
 * is the half the previous app could not show at all. It was assembled by hand
 * from two sites: the Polymesh Portal for last era's realised return, and the
 * old app's live points chart for whether a node was still producing.
 *
 * The trick is that a *share* of points is meaningful long before the era ends.
 * Points accrue roughly uniformly, so an operator holding 1.2% of the points at
 * hour six is likely to hold about 1.2% at hour twenty-four. The absolute count
 * is useless mid-era; the ratio is not.
 *
 *     era pot  = inflation × issuance ÷ erasPerYear
 *     share    = points ÷ totalPoints
 *     gross    = (pot × share ÷ stake) × erasPerYear
 *              = inflation × issuance × points ÷ (totalPoints × stake)
 *
 * `erasPerYear` cancels, which is worth noticing: the estimate does not depend
 * on knowing the era length, only on the inflation rate and the points split.
 * It also reconciles with `stakingReturns` — give every operator an equal share
 * of points and an equal share of stake and this returns `inflation ÷ ratio`,
 * the network APR, exactly.
 *
 * Returns nulls rather than zero when the era has produced no points yet. Zero
 * would read as "this operator is earning nothing", which is a different and
 * much more alarming claim than "the era just started".
 */
export function deriveEstimatedEraApr({
  points,
  totalPoints,
  totalStake,
  commission,
  inflation,
  totalIssuance,
}: EraEstimateInput): AprPoint {
  if (
    points == null ||
    totalPoints == null ||
    totalPoints <= 0 ||
    totalStake == null ||
    totalStake <= 0 ||
    !Number.isFinite(inflation) ||
    totalIssuance <= 0
  ) {
    return NO_APR;
  }

  const gross = (inflation * totalIssuance * points) / (totalPoints * totalStake);

  // As in `deriveOperatorApr`: a missing commission is withheld rather than
  // treated as zero, which would overstate what a nominator receives.
  return { gross, net: commission == null ? null : gross * portionAfterCommission(commission) };
}

/** The most recent non-null entry of a series, with the index it sits at. */
export function lastDefinedAt(
  values: readonly (number | null)[],
): { value: number; index: number } | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) return { value, index: i };
  }
  return null;
}

/** Compounds a derived APR series into APY, preserving gaps. */
export function deriveApy(apr: readonly (number | null)[], erasPerYear: number): (number | null)[] {
  return apr.map((value) => (value == null ? null : aprToApy(value, erasPerYear)));
}

/** Self-stake as a share of total stake — a proxy for skin in the game. */
export function deriveSelfStakeRatio(operator: OperatorSeries): (number | null)[] {
  return operator.ownStake.map((own, i) => {
    const total = operator.totalStake[i];
    if (own == null || total == null || total <= 0) return null;
    return own / total;
  });
}

/**
 * Share of the era's reward points, as a ratio.
 *
 * The comparable measure of block production: raw points depend on how many
 * operators were active, so they are not comparable across eras. This is.
 */
export function derivePointsShare(
  operator: Pick<OperatorSeries, 'points'>,
  network: NullableNetwork<'totalPoints'>,
): (number | null)[] {
  return operator.points.map((points, i) => {
    const total = network.totalPoints[i];
    if (points == null || total == null || total <= 0) return null;
    return points / total;
  });
}

/**
 * Convenience wrapper: every derived series for one operator in one chunk.
 * Returns `null` when the operator has no columns in that chunk, which is the
 * normal case for an operator that joined later.
 */
export function deriveOperatorSeries(chunk: Chunk, address: string, erasPerYear: number) {
  const operator = chunk.operators[address];
  if (!operator) return null;

  const apr = deriveOperatorApr(operator, chunk.network, erasPerYear);

  return {
    eras: chunk.eras,
    reward: deriveOperatorRewards(operator, chunk.network),
    aprGross: apr.gross,
    aprNet: apr.net,
    pointsShare: derivePointsShare(operator, chunk.network),
    selfStakeRatio: deriveSelfStakeRatio(operator),
  };
}
