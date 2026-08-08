import { describe, expect, it } from 'vitest';
import {
  apportionReward,
  aprToApy,
  clamp01,
  curveInflation,
  eraDurationMs,
  eraProgress,
  erasPerYear,
  networkAverageApr,
  operatorApr,
  perbillToRatio,
  portionAfterCommission,
  REWARD_CURVE,
  stakingReturns,
  toPolyx,
  weightedAverageCommission,
  type EraTimingConsts,
} from './staking';

/** Polymesh mainnet: 6s blocks, 3600-block epochs, 4 epochs per era = 24h. */
const MAINNET_TIMING: EraTimingConsts = {
  expectedBlockTimeMs: 6000,
  epochDurationBlocks: 3600,
  sessionsPerEra: 4,
};

describe('era timing', () => {
  it('derives a 24-hour era from mainnet constants', () => {
    expect(eraDurationMs(MAINNET_TIMING)).toBe(24 * 60 * 60 * 1000);
  });

  it('yields 365 eras per year on mainnet', () => {
    expect(erasPerYear(MAINNET_TIMING)).toBeCloseTo(365, 10);
  });

  it('scales with era length rather than assuming 365', () => {
    // A 6-hour era should give four times as many eras per year.
    expect(erasPerYear({ ...MAINNET_TIMING, sessionsPerEra: 1 })).toBeCloseTo(1460, 10);
  });

  it('rejects a zero-length era instead of returning Infinity', () => {
    expect(() => erasPerYear({ ...MAINNET_TIMING, sessionsPerEra: 0 })).toThrow(RangeError);
  });
});

describe('eraProgress', () => {
  const start = 1_754_481_600;
  const day = 24 * 60 * 60;

  it('is 0 at the era start and 1 at the end', () => {
    expect(eraProgress(start, start, MAINNET_TIMING)).toBe(0);
    expect(eraProgress(start, start + day, MAINNET_TIMING)).toBe(1);
  });

  it('interpolates linearly in between', () => {
    expect(eraProgress(start, start + day / 4, MAINNET_TIMING)).toBeCloseTo(0.25, 10);
  });

  it('clamps rather than overflowing when a snapshot lags an era rollover', () => {
    // The snapshot is up to 15 minutes stale, so "now" can exceed the era end
    // before we learn the era changed. A progress bar past 100% looks broken.
    expect(eraProgress(start, start + day * 2, MAINNET_TIMING)).toBe(1);
    expect(eraProgress(start, start - 60, MAINNET_TIMING)).toBe(0);
  });
});

describe('commission', () => {
  it('converts Perbill to a ratio', () => {
    expect(perbillToRatio(100_000_000)).toBeCloseTo(0.1, 12);
    expect(perbillToRatio(0)).toBe(0);
    expect(perbillToRatio(1_000_000_000)).toBe(1);
  });

  it('accepts bigint Perbill without precision loss', () => {
    expect(perbillToRatio(125_000_000n)).toBeCloseTo(0.125, 12);
  });

  it('leaves the nominator share as the complement', () => {
    expect(portionAfterCommission(0.1)).toBeCloseTo(0.9, 12);
    expect(portionAfterCommission(1)).toBe(0);
  });
});

describe('apportionReward', () => {
  it('splits the era reward in proportion to points', () => {
    expect(apportionReward(1000n, 25n, 100n)).toBe(250n);
  });

  it('truncates like the chain rather than rounding', () => {
    // 1000 * 1/3 = 333.33... The chain floors; a float would give 333.33.
    expect(apportionReward(1000n, 1n, 3n)).toBe(333n);
  });

  it('returns zero for an era that scored no points', () => {
    expect(apportionReward(1000n, 0n, 0n)).toBe(0n);
  });

  it('stays exact at balances beyond float53', () => {
    // ~1e18 base units: a Number would silently lose the low digits.
    const reward = 1_000_000_000_000_000_007n;
    expect(apportionReward(reward, 1n, 1n)).toBe(reward);
  });
});

describe('operatorApr', () => {
  const base = {
    eraReward: 36_500n,
    operatorPoints: 10n,
    totalPoints: 100n,
    operatorTotalStake: 36_500n,
    erasPerYear: 365,
  };

  it('computes gross APR from the operator share of the era reward', () => {
    // Node reward = 36500 * 10/100 = 3650. 3650/36500 = 0.1 per era.
    // Annualised: 0.1 * 365 = 36.5
    const { gross } = operatorApr({ ...base, commission: 0 });
    expect(gross).toBeCloseTo(36.5, 10);
  });

  it('deducts commission for the net figure only', () => {
    const { gross, net } = operatorApr({ ...base, commission: 0.2 });
    expect(gross).toBeCloseTo(36.5, 10);
    expect(net).toBeCloseTo(36.5 * 0.8, 10);
  });

  it('returns zero rather than Infinity when nothing is staked', () => {
    const result = operatorApr({ ...base, operatorTotalStake: 0n, commission: 0.1 });
    expect(result).toEqual({ gross: 0, net: 0 });
  });

  it('returns zero when the era scored no points at all', () => {
    const result = operatorApr({
      ...base,
      operatorPoints: 0n,
      totalPoints: 0n,
      commission: 0.1,
    });
    expect(result).toEqual({ gross: 0, net: 0 });
  });
});

describe('aprToApy', () => {
  it('compounds per-era rewards into a higher annual figure', () => {
    expect(aprToApy(0.1, 365)).toBeCloseTo((1 + 0.1 / 365) ** 365 - 1, 12);
    expect(aprToApy(0.1, 365)).toBeGreaterThan(0.1);
  });

  it('equals APR when there is exactly one era per year', () => {
    expect(aprToApy(0.1, 1)).toBeCloseTo(0.1, 12);
  });

  it('is zero for a zero rate', () => {
    expect(aprToApy(0, 365)).toBe(0);
  });
});

describe('weightedAverageCommission', () => {
  it('weights by points, not by operator count', () => {
    // A large productive operator at 5% and a tiny one at 100%.
    const result = weightedAverageCommission(
      [
        { address: 'big', points: 99n, totalStake: 1n, commission: 0.05 },
        { address: 'small', points: 1n, totalStake: 1n, commission: 1 },
      ],
      100n,
    );
    expect(result).toBeCloseTo(0.99 * 0.05 + 0.01 * 1, 10);
    // A plain mean would be 0.525 — wildly misleading.
    expect(result).toBeLessThan(0.1);
  });

  it('normalises over accounted weight when an operator has no prefs entry', () => {
    // Only 50 of 100 points are represented; the average must reflect the
    // operators we know about, not be halved by the missing ones.
    const result = weightedAverageCommission(
      [{ address: 'a', points: 50n, totalStake: 1n, commission: 0.2 }],
      100n,
    );
    expect(result).toBeCloseTo(0.2, 10);
  });

  it('returns zero for an era with no points', () => {
    expect(weightedAverageCommission([], 0n)).toBe(0);
  });
});

describe('networkAverageApr', () => {
  it('weights by stake, so a whale dominates a minnow', () => {
    const operators = [
      { address: 'whale', points: 50n, totalStake: 1_000_000n, commission: 0 },
      { address: 'minnow', points: 50n, totalStake: 1n, commission: 0 },
    ];
    const result = networkAverageApr({
      operators,
      eraReward: 1000n,
      totalPoints: 100n,
      erasPerYear: 365,
    });

    // Both earn 500. Total reward 1000 over total stake 1_000_001.
    expect(result).toBeCloseTo((1000 / 1_000_001) * 365, 8);
  });

  it('accounts for commission, reporting what nominators actually receive', () => {
    const withFee = networkAverageApr({
      operators: [{ address: 'a', points: 100n, totalStake: 1000n, commission: 0.5 }],
      eraReward: 100n,
      totalPoints: 100n,
      erasPerYear: 365,
    });
    const withoutFee = networkAverageApr({
      operators: [{ address: 'a', points: 100n, totalStake: 1000n, commission: 0 }],
      eraReward: 100n,
      totalPoints: 100n,
      erasPerYear: 365,
    });
    expect(withFee).toBeCloseTo(withoutFee / 2, 10);
  });

  it('skips operators with no stake instead of dividing by zero', () => {
    const result = networkAverageApr({
      operators: [{ address: 'a', points: 100n, totalStake: 0n, commission: 0 }],
      eraReward: 100n,
      totalPoints: 100n,
      erasPerYear: 365,
    });
    expect(result).toBe(0);
  });
});

describe('curveInflation', () => {
  it('starts at I0 with nothing staked', () => {
    expect(curveInflation(0)).toBeCloseTo(REWARD_CURVE.i0, 12);
  });

  it('peaks at the ideal staking ratio', () => {
    expect(curveInflation(REWARD_CURVE.xIdeal)).toBeCloseTo(REWARD_CURVE.iIdeal, 12);
  });

  it('rises linearly below the ideal', () => {
    const half = curveInflation(REWARD_CURVE.xIdeal / 2);
    expect(half).toBeCloseTo((REWARD_CURVE.i0 + REWARD_CURVE.iIdeal) / 2, 12);
  });

  it('decays above the ideal', () => {
    const above = curveInflation(0.9);
    expect(above).toBeLessThan(REWARD_CURVE.iIdeal);
    expect(above).toBeGreaterThan(REWARD_CURVE.i0);
  });

  it('is continuous across the ideal ratio', () => {
    const below = curveInflation(REWARD_CURVE.xIdeal - 1e-9);
    const above = curveInflation(REWARD_CURVE.xIdeal + 1e-9);
    expect(Math.abs(above - below)).toBeLessThan(1e-6);
  });
});

describe('stakingReturns', () => {
  it('caps inflation at the fixed yearly reward', () => {
    // Curve would give 14% at the ideal ratio, but the cap allows only 5%.
    const { inflation } = stakingReturns({
      stakingRatio: 0.7,
      totalIssuance: 1_000_000n,
      fixedYearlyReward: 50_000n,
      erasPerYear: 365,
    });
    expect(inflation).toBeCloseTo(0.05, 12);
  });

  it('follows the curve when the cap does not bind', () => {
    const { inflation } = stakingReturns({
      stakingRatio: 0.7,
      totalIssuance: 1_000_000n,
      fixedYearlyReward: 900_000n,
      erasPerYear: 365,
    });
    expect(inflation).toBeCloseTo(REWARD_CURVE.iIdeal, 12);
  });

  it('derives APR as inflation over the staking ratio', () => {
    const { inflation, apr } = stakingReturns({
      stakingRatio: 0.5,
      totalIssuance: 1_000_000n,
      fixedYearlyReward: 900_000n,
      erasPerYear: 365,
    });
    expect(apr).toBeCloseTo(inflation / 0.5, 12);
  });

  it('returns zeroes at a zero staking ratio rather than dividing by zero', () => {
    expect(
      stakingReturns({
        stakingRatio: 0,
        totalIssuance: 1_000_000n,
        fixedYearlyReward: 50_000n,
        erasPerYear: 365,
      }),
    ).toEqual({ inflation: 0, apr: 0, apy: 0 });
  });
});

describe('helpers', () => {
  it('clamps to the unit interval and maps NaN to zero', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it('converts base units to POLYX at the chain decimals', () => {
    expect(toPolyx(1_500_000n, 6)).toBeCloseTo(1.5, 12);
    expect(toPolyx(0n, 6)).toBe(0);
  });
});
