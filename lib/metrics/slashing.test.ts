import { describe, expect, it } from 'vitest';
import {
  equivocationPenalty,
  firstPenalisedOffenderCount,
  nominatorLoss,
  penaltyCurves,
  unresponsivenessPenalty,
} from './slashing';

describe('unresponsivenessPenalty', () => {
  it('is zero for an isolated offender', () => {
    // The whole point of the allowance: one node going offline is a lost
    // reward, not a fine. Getting this wrong would libel every operator that
    // has ever rebooted.
    expect(unresponsivenessPenalty(1, 100)).toBe(0);
  });

  it('stays zero across the whole allowance', () => {
    // allowance = n/10 + 1 = 11 for n = 100
    for (let k = 0; k <= 11; k += 1) {
      expect(unresponsivenessPenalty(k, 100)).toBe(0);
    }
    expect(unresponsivenessPenalty(12, 100)).toBeGreaterThan(0);
  });

  it('caps at 7%', () => {
    expect(unresponsivenessPenalty(100, 100)).toBeCloseTo(0.07, 12);
    // Beyond the point where the inner term saturates, it must not keep rising.
    expect(unresponsivenessPenalty(80, 100)).toBeCloseTo(0.07, 12);
  });

  it('matches the formula at a point inside the ramp', () => {
    // k = 20, n = 100: min(3 * (20 - 11) / 100, 1) * 0.07 = 0.27 * 0.07
    expect(unresponsivenessPenalty(20, 100)).toBeCloseTo(0.27 * 0.07, 12);
  });

  it('returns zero rather than dividing by zero on an empty set', () => {
    expect(unresponsivenessPenalty(5, 0)).toBe(0);
  });
});

describe('equivocationPenalty', () => {
  it('punishes an isolated equivocation lightly but not freely', () => {
    // (3/100)^2 = 0.0009 — small, but unlike unresponsiveness, not zero.
    expect(equivocationPenalty(1, 100)).toBeCloseTo(0.0009, 12);
  });

  it('is quadratic', () => {
    // Doubling the offenders quadruples the penalty, while below the cap.
    const two = equivocationPenalty(2, 100);
    const four = equivocationPenalty(4, 100);
    expect(four).toBeCloseTo(two * 4, 12);
  });

  it('reaches a total slash at one third of the set', () => {
    expect(equivocationPenalty(33, 99)).toBe(1);
    expect(equivocationPenalty(34, 100)).toBe(1);
  });

  it('never exceeds one', () => {
    expect(equivocationPenalty(100, 100)).toBe(1);
  });

  it('returns zero rather than dividing by zero on an empty set', () => {
    expect(equivocationPenalty(5, 0)).toBe(0);
  });
});

describe('penaltyCurves', () => {
  it('samples every offender count inclusive of both ends', () => {
    const curves = penaltyCurves(40);
    expect(curves.offenders).toHaveLength(41);
    expect(curves.offenders[0]).toBe(0);
    expect(curves.offenders.at(-1)).toBe(40);
    expect(curves.unresponsiveness).toHaveLength(41);
    expect(curves.equivocation).toHaveLength(41);
  });

  it('agrees with the scalar functions at every point', () => {
    const n = 25;
    const curves = penaltyCurves(n);
    for (const [i, k] of curves.offenders.entries()) {
      expect(curves.unresponsiveness[i]).toBe(unresponsivenessPenalty(k, n));
      expect(curves.equivocation[i]).toBe(equivocationPenalty(k, n));
    }
  });

  it('produces a single zero point for an empty set rather than throwing', () => {
    expect(penaltyCurves(0).offenders).toEqual([0]);
  });
});

describe('firstPenalisedOffenderCount', () => {
  it('finds the edge of the unresponsiveness allowance', () => {
    expect(firstPenalisedOffenderCount(100, unresponsivenessPenalty)).toBe(12);
  });

  it('is one for equivocation, which has no allowance', () => {
    expect(firstPenalisedOffenderCount(100, equivocationPenalty)).toBe(1);
  });

  it('is null when the curve never leaves zero', () => {
    // The allowance is n/10 + 1, so it only covers every possible offender
    // count when n <= 1. A three-validator set already penalises two offenders.
    expect(firstPenalisedOffenderCount(1, unresponsivenessPenalty)).toBeNull();
    expect(firstPenalisedOffenderCount(3, unresponsivenessPenalty)).toBe(2);
  });
});

describe('nominatorLoss', () => {
  it('is proportional, not diluted by the operator’s other backers', () => {
    expect(nominatorLoss(1000, 0.07)).toBeCloseTo(70, 12);
  });

  it('clamps a fraction outside [0,1]', () => {
    expect(nominatorLoss(1000, 1.5)).toBe(1000);
    expect(nominatorLoss(1000, -0.2)).toBe(0);
  });
});
