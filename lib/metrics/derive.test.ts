import { describe, expect, it } from 'vitest';
import {
  deriveApy,
  deriveOperatorApr,
  deriveOperatorRewards,
  derivePointsShare,
  deriveSelfStakeRatio,
} from './derive';
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
