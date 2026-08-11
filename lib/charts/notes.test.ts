import { describe, expect, it } from 'vitest';
import { axisRangeNote } from './notes';

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
