import { describe, expect, it } from 'vitest';
import { parseIndexerDate } from './client';
describe('parseIndexerDate', () => {
  it('treats a bare datetime as UTC, not local time', () => {
    // The endpoint emits UTC with no zone marker. `Date.parse` reads a bare
    // datetime as *local*, so without the fix every reward shifts by the
    // runner's offset — enough, on a 24h era, to land in the wrong one.
    expect(parseIndexerDate('2021-11-06T17:26:18')).toBe(
      Math.floor(Date.parse('2021-11-06T17:26:18Z') / 1000),
    );
  });

  it('does not double-append a zone that is already there', () => {
    // Appending unconditionally produces `…ZZ`, which parses to NaN — and
    // silently became a 1970 timestamp.
    expect(parseIndexerDate('2026-08-08T12:00:00Z')).toBe(
      Math.floor(Date.parse('2026-08-08T12:00:00Z') / 1000),
    );
    expect(parseIndexerDate('2026-08-08T12:00:00+01:00')).toBe(
      Math.floor(Date.parse('2026-08-08T12:00:00+01:00') / 1000),
    );
  });

  it('handles the inconsistent fractional seconds the endpoint emits', () => {
    expect(parseIndexerDate('2023-03-11T13:26:12.001')).toBe(
      parseIndexerDate('2023-03-11T13:26:12'),
    );
  });

  it('returns 0 for anything unreadable rather than throwing', () => {
    expect(parseIndexerDate('not a date')).toBe(0);
    expect(parseIndexerDate('')).toBe(0);
    expect(parseIndexerDate(null)).toBe(0);
    expect(parseIndexerDate(undefined)).toBe(0);
  });
});
