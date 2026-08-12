import { describe, expect, it } from 'vitest';
import { prefersRollup, rollupToSeries, WEEKLY_ABOVE_ERAS } from './rollup-series';
import type { Rollup } from '@/lib/schemas/data';

/** Three weekly buckets covering eras 1-21. */
const rollup: Rollup = {
  schemaVersion: 1,
  generatedAt: '2026-08-12T00:00:00Z',
  weekStart: [1000, 2000, 3000],
  eraFrom: [1, 8, 15],
  eraTo: [7, 14, 21],
  totalStaked: [100, 110, 120],
  totalIssuance: [1000, 1010, 1020],
  validatorReward: [7, 7.1, 7.2],
  totalPoints: [700, 710, 720],
  avgApr: [0.2, 0.21, 0.22],
  activeOperators: [10, 11, 12],
  nominatorCount: [50, 51, 52],
  avgCommission: [0.1, 0.1, 0.09],
  aprP10: [0.18, 0.19, 0.2],
  aprP50: [0.2, 0.21, 0.22],
  aprP90: [0.22, 0.23, 0.24],
};

describe('rollupToSeries', () => {
  it('exposes the rollup in the shape the charts already take', () => {
    const series = rollupToSeries(rollup, { fromEra: 1, toEra: 21 });
    expect(series?.eras).toEqual([7, 14, 21]);
    expect(series?.eraStart).toEqual([1000, 2000, 3000]);
    expect(series?.network.avgApr).toEqual([0.2, 0.21, 0.22]);
    expect(series?.resolution).toBe('week');
  });

  it('carries the band and commission, not just the headline series', () => {
    // Without these, switching to weekly would silently drop the distribution
    // band and the commission line — changing what the chart shows rather than
    // only how finely it shows it.
    const series = rollupToSeries(rollup, { fromEra: 1, toEra: 21 });
    expect(series?.network.aprP10).toEqual([0.18, 0.19, 0.2]);
    expect(series?.network.aprP90).toEqual([0.22, 0.23, 0.24]);
    expect(series?.network.avgCommission).toEqual([0.1, 0.1, 0.09]);
  });

  it('keeps a bucket the range only partly covers', () => {
    // Range endpoints almost never land on week boundaries. Requiring
    // containment would lop a week off each end of every chart.
    const series = rollupToSeries(rollup, { fromEra: 5, toEra: 16 });
    expect(series?.eras).toEqual([7, 14, 21]);
  });

  it('drops buckets outside the range entirely', () => {
    expect(rollupToSeries(rollup, { fromEra: 15, toEra: 21 })?.eras).toEqual([21]);
    expect(rollupToSeries(rollup, { fromEra: 1, toEra: 7 })?.eras).toEqual([7]);
  });

  it('has no operator columns, and does not invent any', () => {
    expect(rollupToSeries(rollup, { fromEra: 1, toEra: 21 })?.operators).toEqual({});
  });

  it('returns null rather than an empty chart when nothing is selected', () => {
    expect(rollupToSeries(rollup, { fromEra: 500, toEra: 600 })).toBeNull();
    expect(rollupToSeries(undefined, { fromEra: 1, toEra: 21 })).toBeNull();
    expect(rollupToSeries(rollup, undefined)).toBeNull();
  });
});

describe('prefersRollup', () => {
  it('leaves a year and under on the chunks', () => {
    expect(prefersRollup({ fromEra: 1, toEra: WEEKLY_ABOVE_ERAS })).toBe(false);
  });

  it('switches one era past the threshold', () => {
    expect(prefersRollup({ fromEra: 1, toEra: WEEKLY_ABOVE_ERAS + 1 })).toBe(true);
  });

  it('is false with no range at all', () => {
    expect(prefersRollup(undefined)).toBe(false);
  });
});
