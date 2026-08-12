import { describe, expect, it } from 'vitest';
import { axisRangeNote, outlierCap } from './notes';

const plain = (v: number) => String(v);

describe('axisRangeNote', () => {
  it('states the observed range and that the axis is not zero-based', () => {
    const note = axisRangeNote([10, 4, 7], plain);
    expect(note).toContain('Between 4 and 10');
    expect(note).toContain('not to zero');
  });

  it('ignores gaps rather than treating them as zero', () => {
    // An operator absent from an era did not score nothing, and a note claiming
    // the series reached zero would contradict the chart, which breaks the line.
    expect(axisRangeNote([5, null, 9, undefined], plain)).toContain('Between 5 and 9');
  });

  it('says nothing about a series that never moves', () => {
    // A flat line needs no explanation of its scale, and offering one implies
    // there is variation to look for.
    expect(axisRangeNote([3, 3, 3], plain)).toBeNull();
  });

  it('says nothing when there is no data', () => {
    expect(axisRangeNote([], plain)).toBeNull();
    expect(axisRangeNote([null, null], plain)).toBeNull();
  });

  it('survives a series that is entirely non-finite', () => {
    expect(axisRangeNote([Number.NaN, Number.POSITIVE_INFINITY], plain)).toBeNull();
  });
});

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

describe('outlierCap', () => {
  it('caps an axis a single bootstrap point would otherwise own', () => {
    // The real shape: one enormous first week, then a settled series.
    const values = [125.6, ...Array.from({ length: 60 }, () => 0.2)];
    const cap = outlierCap(values, pct);
    expect(cap?.max).toBeLessThan(1);
    expect(cap?.note).toContain('One point runs');
    expect(cap?.note).toContain('12560%');
  });

  it('leaves an ordinary series alone', () => {
    // Nothing far from the median, so no cap and no note. Capping here would
    // crop real variation and claim an outlier that does not exist.
    expect(outlierCap([0.19, 0.2, 0.21, 0.22, 0.2], pct)).toBeNull();
  });

  it('refuses to cap when the tail is the shape of the data', () => {
    // A fifth of the series above the line is a distribution, not an outlier,
    // and cutting it would misrepresent the series rather than clean it up.
    const values = [...Array.from({ length: 8 }, () => 0.2), 10, 11];
    expect(outlierCap(values, pct)).toBeNull();
  });

  it('keeps the highest legitimate point inside the plot', () => {
    // The cap must clear the real range, or capping would crop the data it is
    // meant to reveal.
    const values = [...Array.from({ length: 40 }, () => 0.2), 0.45, 50];
    const cap = outlierCap(values, pct);
    expect(cap?.max).toBeGreaterThan(0.45);
    expect(cap?.max).toBeLessThan(1);
  });

  it('needs enough points to tell an outlier from a distribution', () => {
    // One value among five is a fifth of the series. With so little to go on
    // there is no basis for calling it an outlier, so no cap is offered.
    expect(outlierCap([0.1, 0.2, 0.3, 0.4, 50], pct)).toBeNull();
  });

  it('takes the reason for the outliers from the caller', () => {
    // Hardcoding it produced "in the chain's earliest weeks" on an operator
    // page, where the spike is that validator's own first era. A confidently
    // wrong explanation is worse than none.
    const values = [...Array.from({ length: 40 }, () => 0.2), 30];
    const cap = outlierCap(values, pct, { because: 'when the node had just joined' });
    expect(cap?.note).toContain('when the node had just joined');
    expect(cap?.note).not.toContain('chain');
  });

  it('says nothing with too little data to judge', () => {
    expect(outlierCap([1, 100], pct)).toBeNull();
    expect(outlierCap([], pct)).toBeNull();
  });

  it('does not divide by a zero median', () => {
    expect(outlierCap([0, 0, 0, 0, 5], pct)).toBeNull();
  });
});
