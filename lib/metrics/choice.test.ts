import { describe, expect, it } from 'vitest';
import { compareChoice, type ChoiceInput } from './choice';
import type { OperatorSeries } from '@/lib/schemas/data';

const ERAS = [100, 101, 102, 103];

/**
 * An operator that scores `points` every era against a fixed stake, at a fixed
 * commission. The network pays a flat reward each era, so gross return follows
 * points directly and every figure below is checkable by hand.
 */
function operator(points: number, commission: number, totalStake = 1_000_000): OperatorSeries {
  const fill = <T>(v: T) => ERAS.map(() => v);
  return {
    points: fill(points),
    commission: fill(commission),
    totalStake: fill(totalStake),
    ownStake: fill(0),
    nominatorCount: fill(1),
  } as unknown as OperatorSeries;
}

function chain(operators: Record<string, OperatorSeries>): Omit<ChoiceInput, 'picks'> {
  const total = ERAS.map((_, i) =>
    Object.values(operators).reduce((sum, o) => sum + (o.points[i] as number), 0),
  );
  return {
    eras: ERAS,
    network: { validatorReward: ERAS.map(() => 100_000), totalPoints: total },
    operators,
    erasPerYear: 365,
  };
}

describe('compareChoice', () => {
  it('reports no difference when the pick is the field', () => {
    const input = chain({ a: operator(1000, 0.1), b: operator(1000, 0.1) });
    const result = compareChoice({ ...input, picks: [{ address: 'a', weight: 1 }] });

    expect(result?.difference).toBeCloseTo(0, 10);
    expect(result?.yourNet).toBeCloseTo(result?.fieldNet ?? 0, 10);
  });

  it('attributes a cheaper operator entirely to commission', () => {
    // Same production, lower fee. Nothing about the node is better.
    const input = chain({ cheap: operator(1000, 0.08), dear: operator(1000, 0.12) });
    const result = compareChoice({ ...input, picks: [{ address: 'cheap', weight: 1 }] });

    expect(result?.fromProduction).toBeCloseTo(0, 10);
    expect(result?.fromCommission).toBeCloseTo(result?.difference ?? 0, 10);
    expect(result?.difference).toBeGreaterThan(0);
  });

  it('attributes a better producer entirely to production', () => {
    const input = chain({ fast: operator(1200, 0.1), slow: operator(800, 0.1) });
    const result = compareChoice({ ...input, picks: [{ address: 'fast', weight: 1 }] });

    expect(result?.fromCommission).toBeCloseTo(0, 10);
    expect(result?.fromProduction).toBeCloseTo(result?.difference ?? 0, 10);
  });

  it('splits a pick that differs on both, and the parts sum exactly', () => {
    const input = chain({
      good: operator(1200, 0.08),
      mid: operator(1000, 0.1),
      poor: operator(800, 0.12),
    });
    const result = compareChoice({ ...input, picks: [{ address: 'good', weight: 1 }] });
    if (!result) throw new Error('expected a comparison');

    expect(result.fromCommission).toBeGreaterThan(0);
    expect(result.fromProduction).toBeGreaterThan(0);
    expect(result.fromCommission + result.fromProduction + result.unexplained).toBeCloseTo(
      result.difference,
      12,
    );
  });

  it('leaves almost nothing unexplained on a realistic field', () => {
    // Commission spans 8-12% while production spans about 1%, so the covariance
    // between the two is negligible — which is the assumption the UI relies on
    // when it reports only the two named parts and drops the remainder.
    //
    // Asserted as a share of the difference, not as an absolute: this fixture
    // pays a reward that works out to a four-figure APR, so any absolute
    // threshold would be testing the fixture's scale rather than the maths.
    const input = chain({
      a: operator(1010, 0.08),
      b: operator(1000, 0.1),
      c: operator(990, 0.12),
    });
    const result = compareChoice({ ...input, picks: [{ address: 'a', weight: 1 }] });
    if (!result) throw new Error('expected a comparison');
    expect(Math.abs(result.unexplained) / Math.abs(result.difference)).toBeLessThan(0.01);
  });

  it('weights the picks by the stake actually assigned to each', () => {
    // Sixteen nominations with stake behind one of them is the normal case, and
    // an unweighted average would describe a portfolio nobody holds.
    const input = chain({ fast: operator(1200, 0.1), slow: operator(800, 0.1) });
    const weighted = compareChoice({
      ...input,
      picks: [
        { address: 'fast', weight: 0 },
        { address: 'slow', weight: 1000 },
      ],
    });
    const only = compareChoice({ ...input, picks: [{ address: 'slow', weight: 1 }] });

    expect(weighted?.yourNet).toBeCloseTo(only?.yourNet ?? 0, 12);
  });

  it('falls back to equal weight when nothing is assigned', () => {
    // The era after re-nominating: the picks are real, the exposure is not yet.
    const input = chain({ fast: operator(1200, 0.1), slow: operator(800, 0.1) });
    const result = compareChoice({
      ...input,
      picks: [
        { address: 'fast', weight: 0 },
        { address: 'slow', weight: 0 },
      ],
    });
    expect(result?.difference).toBeCloseTo(0, 10);
  });

  it('counts only the picks it has history for', () => {
    const input = chain({ known: operator(1000, 0.1) });
    const result = compareChoice({
      ...input,
      picks: [
        { address: 'known', weight: 1 },
        { address: 'never-seen', weight: 1 },
      ],
    });
    expect(result?.covered).toBe(1);
  });

  it('returns null rather than a fabricated zero when nothing is comparable', () => {
    const input = chain({ a: operator(1000, 0.1) });
    expect(compareChoice({ ...input, picks: [] })).toBeNull();
    expect(compareChoice({ ...input, picks: [{ address: 'ghost', weight: 1 }] })).toBeNull();
    expect(compareChoice({ ...input, eras: [], picks: [{ address: 'a', weight: 1 }] })).toBeNull();
  });
});
