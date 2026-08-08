import { describe, expect, it } from 'vitest';
import {
  cumulativeDeviation,
  distributionBand,
  giniCoefficient,
  herfindahlIndex,
  lorenzCurve,
  mean,
  nakamotoCoefficient,
  quantile,
  stdDev,
  topNShare,
} from './stats';

describe('quantile', () => {
  const sample = [1, 2, 3, 4, 5];

  it('returns the median at q=0.5', () => {
    expect(quantile(sample, 0.5)).toBe(3);
  });

  it('returns the extremes at q=0 and q=1', () => {
    expect(quantile(sample, 0)).toBe(1);
    expect(quantile(sample, 1)).toBe(5);
  });

  it('interpolates linearly between samples', () => {
    // R-7: position = (4-1)*0.25 = 0.75 -> between index 0 and 1.
    expect(quantile([0, 10, 20, 30], 0.25)).toBeCloseTo(7.5, 10);
  });

  it('sorts unordered input', () => {
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
  });

  it('returns null for an empty sample rather than NaN', () => {
    expect(quantile([], 0.5)).toBeNull();
  });

  it('handles a single value', () => {
    expect(quantile([42], 0.1)).toBe(42);
  });
});

describe('distributionBand', () => {
  it('produces an ordered p10 <= p50 <= p90', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const { p10, p50, p90 } = distributionBand(values);
    expect(p10!).toBeLessThan(p50!);
    expect(p50!).toBeLessThan(p90!);
  });

  it('ignores nulls — an absent operator is not a zero', () => {
    // If nulls counted as 0 the band would be dragged toward the floor.
    const withNulls = distributionBand([null, null, 10, 20, 30]);
    const without = distributionBand([10, 20, 30]);
    expect(withNulls).toEqual(without);
  });

  it('returns nulls when every value is absent', () => {
    expect(distributionBand([null, null])).toEqual({ p10: null, p50: null, p90: null });
  });

  it('ignores non-finite values', () => {
    expect(distributionBand([Number.NaN, Number.POSITIVE_INFINITY, 5])).toEqual({
      p10: 5,
      p50: 5,
      p90: 5,
    });
  });
});

describe('mean and stdDev', () => {
  it('averages only the present values', () => {
    expect(mean([1, null, 3])).toBe(2);
  });

  it('returns null when nothing is present', () => {
    expect(mean([null, null])).toBeNull();
    expect(stdDev([null])).toBeNull();
  });

  it('uses the sample (n-1) denominator', () => {
    // Population sd of [2,4] is 1; sample sd is sqrt(2) ~ 1.414.
    expect(stdDev([2, 4])).toBeCloseTo(Math.SQRT2, 10);
  });

  it('needs at least two values', () => {
    expect(stdDev([5])).toBeNull();
  });
});

describe('cumulativeDeviation', () => {
  it('accumulates relative deviation era by era', () => {
    // 10% above reference three times running.
    const result = cumulativeDeviation([110, 110, 110], [100, 100, 100]);
    expect(result[0]).toBeCloseTo(0.1, 10);
    expect(result[1]).toBeCloseTo(0.2, 10);
    expect(result[2]).toBeCloseTo(0.3, 10);
  });

  it('goes negative for consistent underperformance', () => {
    const result = cumulativeDeviation([90, 90], [100, 100]);
    expect(result[1]).toBeCloseTo(-0.2, 10);
  });

  it('holds the running total across a gap rather than resetting', () => {
    // An operator that leaves the active set and returns must keep a
    // continuous line — resetting to zero would read as a crash.
    const result = cumulativeDeviation([110, null, 110], [100, 100, 100]);
    expect(result[0]).toBeCloseTo(0.1, 10);
    expect(result[1]).toBeCloseTo(0.1, 10);
    expect(result[2]).toBeCloseTo(0.2, 10);
  });

  it('emits null until the first comparable era', () => {
    const result = cumulativeDeviation([null, 110], [100, 100]);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(0.1, 10);
  });

  it('skips eras where the reference is zero', () => {
    const result = cumulativeDeviation([110, 110], [0, 100]);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(0.1, 10);
  });
});

describe('nakamotoCoefficient', () => {
  it('counts the smallest group exceeding one third', () => {
    // One operator holds 40% of 100 — alone it exceeds a third.
    expect(nakamotoCoefficient([40, 20, 20, 20])).toBe(1);
  });

  it('needs more operators when stake is even', () => {
    // Ten equal operators: four are needed to exceed one third.
    expect(nakamotoCoefficient(Array(10).fill(10))).toBe(4);
  });

  it('accepts a custom threshold', () => {
    expect(nakamotoCoefficient(Array(10).fill(10), 0.5)).toBe(6);
  });

  it('returns 0 when there is no stake', () => {
    expect(nakamotoCoefficient([])).toBe(0);
    expect(nakamotoCoefficient([0, 0])).toBe(0);
  });
});

describe('herfindahlIndex', () => {
  it('is 0 for a perfectly even distribution', () => {
    expect(herfindahlIndex([25, 25, 25, 25])).toBeCloseTo(0, 12);
  });

  it('is 1 for a single holder', () => {
    expect(herfindahlIndex([100])).toBe(1);
  });

  it('rises as stake concentrates', () => {
    const even = herfindahlIndex([25, 25, 25, 25]);
    const skewed = herfindahlIndex([70, 10, 10, 10]);
    expect(skewed).toBeGreaterThan(even);
  });

  it('returns 0 with no stake', () => {
    expect(herfindahlIndex([])).toBe(0);
  });
});

describe('topNShare', () => {
  it('sums the largest n shares', () => {
    expect(topNShare([50, 30, 15, 5], 2)).toBeCloseTo(0.8, 10);
  });

  it('caps at the full set', () => {
    expect(topNShare([50, 50], 10)).toBeCloseTo(1, 10);
  });

  it('returns 0 with no stake', () => {
    expect(topNShare([], 3)).toBe(0);
  });
});

describe('lorenzCurve and giniCoefficient', () => {
  it('traces the diagonal for perfect equality', () => {
    const curve = lorenzCurve([10, 10, 10, 10]);
    for (const point of curve) {
      expect(point.y).toBeCloseTo(point.x, 10);
    }
    expect(giniCoefficient([10, 10, 10, 10])).toBeCloseTo(0, 10);
  });

  it('starts at the origin and ends at (1,1)', () => {
    const curve = lorenzCurve([1, 2, 3]);
    expect(curve[0]).toEqual({ x: 0, y: 0 });
    expect(curve.at(-1)!.x).toBeCloseTo(1, 12);
    expect(curve.at(-1)!.y).toBeCloseTo(1, 12);
  });

  it('rises toward 1 as concentration increases', () => {
    const even = giniCoefficient([10, 10, 10, 10]);
    const skewed = giniCoefficient([97, 1, 1, 1]);
    expect(skewed).toBeGreaterThan(even);
    expect(skewed).toBeLessThanOrEqual(1);
  });

  it('stays within [0,1]', () => {
    expect(giniCoefficient([1_000_000, 1])).toBeGreaterThanOrEqual(0);
    expect(giniCoefficient([1_000_000, 1])).toBeLessThanOrEqual(1);
  });

  it('degrades gracefully with no stake', () => {
    expect(lorenzCurve([])).toEqual([{ x: 0, y: 0 }]);
    expect(giniCoefficient([])).toBe(0);
  });
});
