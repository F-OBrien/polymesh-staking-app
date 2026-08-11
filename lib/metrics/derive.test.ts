import { describe, expect, it } from 'vitest';
import {
  deriveApy,
  deriveEstimatedEraApr,
  deriveOperatorApr,
  deriveOperatorRewards,
  derivePointsShare,
  deriveSelfStakeRatio,
  lastDefinedAt,
} from './derive';
import { stakingReturns } from './staking';
import type { NetworkSeries, OperatorSeries } from '@/lib/schemas/data';

/** Three eras. Era index 1 is a gap: the operator was not in the active set. */
const operator: OperatorSeries = {
  points: [100, null, 200],
  commission: [0.1, null, 0.2],
  totalStake: [1000, null, 2000],
  ownStake: [100, null, 500],
  nominatorCount: [10, null, 20],
};

const network: Pick<NetworkSeries, 'validatorReward' | 'totalPoints'> = {
  validatorReward: [1000, 1000, 1000],
  totalPoints: [1000, 1000, 1000],
};

const EPY = 365;

describe('deriveOperatorRewards', () => {
  it('apportions the era reward by points share', () => {
    // 100/1000 of 1000 = 100; 200/1000 of 1000 = 200.
    expect(deriveOperatorRewards(operator, network)).toEqual([100, null, 200]);
  });

  it('preserves gaps rather than emitting zero', () => {
    expect(deriveOperatorRewards(operator, network)[1]).toBeNull();
  });

  it('returns null for an era that scored no points network-wide', () => {
    const stalled = { validatorReward: [1000], totalPoints: [0] };
    expect(deriveOperatorRewards({ points: [50] }, stalled)).toEqual([null]);
  });

  it('truncates like the chain instead of rounding up', () => {
    const result = deriveOperatorRewards(
      { points: [1] },
      { validatorReward: [1000], totalPoints: [3] },
    );
    // 1000/3 = 333.333...; scaled integer division floors it.
    expect(result[0]).toBeCloseTo(333.333333, 5);
    expect(result[0]!).toBeLessThan(333.334);
  });
});

describe('deriveOperatorApr', () => {
  it('computes gross from reward over stake, annualised', () => {
    const { gross } = deriveOperatorApr(operator, network, EPY);
    // Era 0: reward 100 on stake 1000 = 0.1 per era -> 36.5 annualised.
    expect(gross[0]).toBeCloseTo(36.5, 6);
    // Era 2: reward 200 on stake 2000 = 0.1 per era -> same.
    expect(gross[2]).toBeCloseTo(36.5, 6);
  });

  it('applies commission only to the net figure', () => {
    const { gross, net } = deriveOperatorApr(operator, network, EPY);
    expect(net[0]).toBeCloseTo(gross[0]! * 0.9, 6);
    expect(net[2]).toBeCloseTo(gross[2]! * 0.8, 6);
  });

  it('preserves gaps in both series', () => {
    const { gross, net } = deriveOperatorApr(operator, network, EPY);
    expect(gross[1]).toBeNull();
    expect(net[1]).toBeNull();
  });

  it('withholds net when commission is unknown but points were scored', () => {
    // An operator can score points in an era with no preferences entry.
    // Assuming zero commission would overstate the nominator's return, so the
    // honest answer is "unknown", not "free".
    const noPrefs: OperatorSeries = {
      points: [100],
      commission: [null],
      totalStake: [1000],
      ownStake: [100],
      nominatorCount: [5],
    };
    const { gross, net } = deriveOperatorApr(
      noPrefs,
      {
        validatorReward: [1000],
        totalPoints: [1000],
      },
      EPY,
    );
    expect(gross[0]).toBeCloseTo(36.5, 6);
    expect(net[0]).toBeNull();
  });

  it('returns null rather than Infinity when stake is zero', () => {
    const zeroStake: OperatorSeries = {
      points: [100],
      commission: [0.1],
      totalStake: [0],
      ownStake: [0],
      nominatorCount: [0],
    };
    const { gross, net } = deriveOperatorApr(
      zeroStake,
      {
        validatorReward: [1000],
        totalPoints: [1000],
      },
      EPY,
    );
    expect(gross[0]).toBeNull();
    expect(net[0]).toBeNull();
  });
});

describe('deriveApy', () => {
  it('compounds and preserves gaps', () => {
    const result = deriveApy([0.1, null], EPY);
    expect(result[0]).toBeGreaterThan(0.1);
    expect(result[1]).toBeNull();
  });
});

describe('deriveSelfStakeRatio', () => {
  it('divides own stake by total stake', () => {
    expect(deriveSelfStakeRatio(operator)).toEqual([0.1, null, 0.25]);
  });

  it('returns null when total stake is zero', () => {
    const zero: OperatorSeries = {
      points: [1],
      commission: [0],
      totalStake: [0],
      ownStake: [0],
      nominatorCount: [0],
    };
    expect(deriveSelfStakeRatio(zero)).toEqual([null]);
  });
});

describe('derivePointsShare', () => {
  it('normalises points against the era total', () => {
    // Raw points are not comparable across eras; the share is.
    expect(derivePointsShare(operator, network)).toEqual([0.1, null, 0.2]);
  });

  it('returns null for a stalled era', () => {
    expect(derivePointsShare({ points: [50] }, { totalPoints: [0] })).toEqual([null]);
  });
});

describe('deriveEstimatedEraApr', () => {
  /** An operator holding a tenth of the points and a tenth of the stake. */
  const base = {
    points: 100,
    totalPoints: 1000,
    totalStake: 100_000,
    commission: 0.1,
    inflation: 0.08,
    totalIssuance: 1_000_000,
  };

  it('annualises the operator’s share of the era pot against its stake', () => {
    // inflation × issuance × share ÷ stake = 0.08 × 1e6 × 0.1 ÷ 1e5 = 0.08
    const { gross, net } = deriveEstimatedEraApr(base);
    expect(gross).toBeCloseTo(0.08, 12);
    // Commission is taken off the whole return, so net = gross × (1 − 0.1).
    expect(net).toBeCloseTo(0.072, 12);
  });

  it('reconciles exactly with the network-wide APR', () => {
    // The strongest check available: give every operator an equal share of
    // points and of stake, and this must return `inflation ÷ stakingRatio` —
    // the same number `stakingReturns` produces from the reward curve. If the
    // two ever disagree, one of them is wrong, and a per-operator estimate
    // that does not sum back to the network figure is the wrong one.
    const totalIssuance = 1_000_000_000n;
    const totalStaked = 500_000_000n;
    const stakingRatio = Number(totalStaked) / Number(totalIssuance);
    const operators = 50;

    const { inflation, apr } = stakingReturns({
      stakingRatio,
      totalIssuance,
      fixedYearlyReward: 10_000_000_000n,
      erasPerYear: 365,
    });

    const { gross } = deriveEstimatedEraApr({
      points: 1,
      totalPoints: operators,
      totalStake: Number(totalStaked) / operators,
      commission: 0,
      inflation,
      totalIssuance: Number(totalIssuance),
    });

    expect(gross).toBeCloseTo(apr, 12);
  });

  it('depends on the points share, not on how far into the era it is', () => {
    // This is what makes a mid-era estimate meaningful at all. Six hours in,
    // every count is a quarter of its final value, but the *ratio* is already
    // what it will be — so the answer must not move when both counts scale
    // together. It is also why `erasPerYear` cancels out of the derivation and
    // the signature does not take it.
    const quarterWayThrough = deriveEstimatedEraApr({ ...base, points: 25, totalPoints: 250 });
    const fullEra = deriveEstimatedEraApr({ ...base, points: 100, totalPoints: 1000 });
    expect(quarterWayThrough.gross).toBeCloseTo(fullEra.gross!, 12);
    expect(quarterWayThrough.gross).toBeCloseTo(0.08, 12);
  });

  it('scales linearly with the points share', () => {
    const half = deriveEstimatedEraApr({ ...base, points: 50 });
    expect(half.gross).toBeCloseTo(0.04, 12);
  });

  it('withholds rather than reporting zero when the era has no points yet', () => {
    // Zero would read as "this operator is earning nothing", which is a very
    // different and far more alarming claim than "the era just started".
    expect(deriveEstimatedEraApr({ ...base, totalPoints: 0 })).toEqual({
      gross: null,
      net: null,
    });
    expect(deriveEstimatedEraApr({ ...base, points: null })).toEqual({ gross: null, net: null });
  });

  it('reports zero for an operator that has genuinely scored nothing', () => {
    // Distinct from the case above: the era is producing points and this
    // operator has none, which is real information about a node being down.
    expect(deriveEstimatedEraApr({ ...base, points: 0 }).gross).toBe(0);
  });

  it('withholds the net figure when commission is unknown', () => {
    // Treating a missing commission as zero would overstate what a nominator
    // receives — the same rule `deriveOperatorApr` follows.
    const { gross, net } = deriveEstimatedEraApr({ ...base, commission: null });
    expect(gross).toBeCloseTo(0.08, 12);
    expect(net).toBeNull();
  });

  it('withholds when the operator has no stake behind it', () => {
    expect(deriveEstimatedEraApr({ ...base, totalStake: 0 })).toEqual({ gross: null, net: null });
  });
});

describe('lastDefinedAt', () => {
  it('finds the most recent value and where it sits', () => {
    expect(lastDefinedAt([0.1, null, 0.3, null])).toEqual({ value: 0.3, index: 2 });
  });

  it('returns null for an empty or wholly missing series', () => {
    expect(lastDefinedAt([])).toBeNull();
    expect(lastDefinedAt([null, null])).toBeNull();
  });

  it('treats zero as a value, not a gap', () => {
    expect(lastDefinedAt([0.5, 0])).toEqual({ value: 0, index: 1 });
  });
});
