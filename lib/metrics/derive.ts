import type { Chunk, NetworkSeries, OperatorSeries } from '@/lib/schemas/data';
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
  network: Pick<NetworkSeries, 'validatorReward' | 'totalPoints'>,
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
  network: Pick<NetworkSeries, 'validatorReward' | 'totalPoints'>,
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
  network: Pick<NetworkSeries, 'totalPoints'>,
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
