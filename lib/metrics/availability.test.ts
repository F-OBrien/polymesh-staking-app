import { describe, expect, it } from 'vitest';
import { summariseAvailability } from './availability';

const eras = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe('summariseAvailability', () => {
  it('counts eras absent from the set between first and last seen', () => {
    const summary = summariseAvailability({
      eras: eras(100, 6),
      points: [10, null, null, 10, 10, 10],
    })!;
    expect(summary.window).toBe(6);
    expect(summary.inSet).toBe(4);
    expect(summary.missed).toBe(2);
    expect(summary.rate).toBeCloseTo(4 / 6);
  });

  it('starts the window at the operator’s first era, not the range’s', () => {
    // Otherwise every operator that joined recently reports near-total
    // absence: on a 365-era chart a validator three eras old would be shown
    // as having missed 362 eras it did not exist for.
    const summary = summariseAvailability({
      eras: eras(1, 10),
      points: [null, null, null, null, null, null, null, 5, 5, 5],
    })!;
    expect(summary.fromEra).toBe(8);
    expect(summary.window).toBe(3);
    expect(summary.missed).toBe(0);
    expect(summary.rate).toBe(1);
  });

  it('ends the window at the last era with data', () => {
    const summary = summariseAvailability({
      eras: eras(1, 6),
      points: [5, 5, 5, null, null, null],
    })!;
    expect(summary.toEra).toBe(3);
    expect(summary.missed).toBe(0);
  });

  it('counts an elected era with zero points separately', () => {
    // A validator elected with its node down is present in every column with
    // zero points. It leaves no gap in the line, so without this the page
    // cannot show that kind of outage at all.
    const summary = summariseAvailability({
      eras: eras(1, 4),
      points: [10, 0, 0, 10],
    })!;
    expect(summary.missed).toBe(0);
    expect(summary.blank).toBe(2);
    expect(summary.inSet).toBe(4);
  });

  it('reports absences longest first', () => {
    const summary = summariseAvailability({
      eras: eras(1, 9),
      points: [1, null, 1, null, null, null, 1, null, 1],
    })!;
    expect(summary.runs).toEqual([
      { fromEra: 4, toEra: 6, eras: 3 },
      { fromEra: 2, toEra: 2, eras: 1 },
      { fromEra: 8, toEra: 8, eras: 1 },
    ]);
  });

  it('returns null when the operator has no record in the range', () => {
    // Not a zeroed summary: "0 missed of 0" reads as a clean sheet, which is
    // the opposite of having nothing to say.
    expect(summariseAvailability({ eras: eras(1, 3), points: [null, null, null] })).toBeNull();
    expect(summariseAvailability({ eras: [], points: [] })).toBeNull();
  });

  it('treats a non-finite value as absent, as the charts do', () => {
    const summary = summariseAvailability({
      eras: eras(1, 3),
      points: [1, Number.NaN, 1],
    })!;
    expect(summary.missed).toBe(1);
  });

  it('reports a perfect record as such', () => {
    const summary = summariseAvailability({ eras: eras(1, 5), points: [1, 2, 3, 4, 5] })!;
    expect(summary.missed).toBe(0);
    expect(summary.blank).toBe(0);
    expect(summary.rate).toBe(1);
    expect(summary.runs).toEqual([]);
  });
});
