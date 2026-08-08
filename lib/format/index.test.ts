import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  formatBaseUnits,
  formatDuration,
  formatEraDate,
  formatNumber,
  formatPercent,
  formatPolyx,
  formatRelativeTime,
  truncateAddress,
} from './index';

describe('absent values', () => {
  // A missing value and a zero mean different things: an operator absent from
  // an era did not score nothing, it was not there. Rendering null as 0 would
  // erase that distinction everywhere it matters.
  it.each([
    ['formatPercent', formatPercent(null)],
    ['formatPolyx', formatPolyx(null)],
    ['formatNumber', formatNumber(null)],
    ['formatBaseUnits', formatBaseUnits(null, 6)],
    ['formatEraDate', formatEraDate(null)],
    ['formatDuration', formatDuration(null)],
    ['formatRelativeTime', formatRelativeTime(null)],
  ])('%s renders an em dash for null', (_name, result) => {
    expect(result).toBe(EMPTY);
  });

  it.each([
    ['NaN', formatPercent(Number.NaN)],
    ['Infinity', formatPolyx(Number.POSITIVE_INFINITY)],
  ])('renders an em dash for %s rather than a broken string', (_name, result) => {
    expect(result).toBe(EMPTY);
  });

  it('still renders a genuine zero', () => {
    expect(formatPolyx(0)).toBe('0');
    expect(formatPercent(0)).toContain('0');
  });
});

describe('formatPercent', () => {
  it('converts a ratio to a percentage', () => {
    expect(formatPercent(0.1234)).toBe('12.34%');
  });

  it('honours the decimals option', () => {
    expect(formatPercent(0.1234, { decimals: 0 })).toBe('12%');
    expect(formatPercent(0.1234, { decimals: 1 })).toBe('12.3%');
  });

  it('shows an explicit sign when asked, for deltas', () => {
    expect(formatPercent(0.05, { signed: true })).toBe('+5.00%');
    expect(formatPercent(-0.05, { signed: true })).toBe('-5.00%');
  });

  it('does not sign a zero even when signed', () => {
    expect(formatPercent(0, { signed: true })).not.toContain('+');
  });
});

describe('formatPolyx', () => {
  it('groups thousands', () => {
    expect(formatPolyx(1234567)).toMatch(/1[,\s]?234[,\s]?567/);
  });

  it('abbreviates in compact mode', () => {
    expect(formatPolyx(5_240_000, { compact: true })).toMatch(/5\.2M/);
  });

  it('appends the symbol on request', () => {
    expect(formatPolyx(100, { symbol: true })).toBe('100 POLYX');
  });
});

describe('formatBaseUnits', () => {
  it('scales exact base units to POLYX', () => {
    expect(formatBaseUnits('1500000', 6, { decimals: 2 })).toBe('1.50');
  });

  it('handles values beyond float53 without throwing', () => {
    expect(formatBaseUnits('1000000000000000000', 6, { compact: true })).toMatch(/1(\.0)?T/);
  });

  it('renders an em dash for a non-numeric string rather than NaN', () => {
    expect(formatBaseUnits('not-a-number', 6)).toBe(EMPTY);
  });
});

describe('truncateAddress', () => {
  const address = '2F5rUD5cYMmHqSSmV14UmMExgeaeR4Xdgu2zM2PQZeEFaBNz';

  it('keeps both ends, since the tail is what people compare', () => {
    expect(truncateAddress(address)).toBe('2F5rU…aBNz');
  });

  it('leaves short strings alone', () => {
    expect(truncateAddress('abc')).toBe('abc');
  });

  it('accepts custom lengths', () => {
    expect(truncateAddress(address, 3, 3)).toBe('2F5…BNz');
  });
});

describe('formatDuration', () => {
  it('shows at most two units', () => {
    expect(formatDuration(2 * 86_400 + 4 * 3600 + 30 * 60)).toBe('2d 4h');
    expect(formatDuration(4 * 3600 + 12 * 60 + 5)).toBe('4h 12m');
    expect(formatDuration(12 * 60 + 30)).toBe('12m 30s');
    expect(formatDuration(45)).toBe('45s');
  });

  it('clamps a negative duration to zero rather than showing "-1s"', () => {
    // The 15-minute snapshot can lag an era rollover, so "time remaining" can
    // legitimately go negative before we learn the era changed.
    expect(formatDuration(-100)).toBe('0s');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-08-08T12:00:00Z');

  it('describes recent past times', () => {
    expect(formatRelativeTime('2026-08-08T11:45:00Z', now)).toMatch(/15 minutes ago/);
  });

  it('escalates units as the gap grows', () => {
    expect(formatRelativeTime('2026-08-08T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(formatRelativeTime('2026-08-05T12:00:00Z', now)).toMatch(/3 days ago/);
  });

  it('handles an unparseable timestamp', () => {
    expect(formatRelativeTime('not a date', now)).toBe(EMPTY);
  });
});

describe('formatEraDate', () => {
  it('formats a unix timestamp as a short date', () => {
    // Dates are what people think in; the era index stays secondary.
    expect(formatEraDate(Date.UTC(2026, 7, 8) / 1000)).toMatch(/Aug/);
  });

  it('adds the year on request', () => {
    expect(formatEraDate(Date.UTC(2026, 7, 8) / 1000, { withYear: true })).toMatch(/2026/);
  });
});
