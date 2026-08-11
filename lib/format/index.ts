/**
 * Display formatting.
 *
 * Every number a user reads passes through here, so the rules live in one
 * place rather than being re-decided per component. Two conventions:
 *
 *  - **Ratios stay ratios internally.** Only these functions multiply by 100.
 *    The previous app mixed ratios and percentages in its data model and
 *    multiplied at inconsistent points.
 *  - **`null` renders as an em dash, never as 0 or NaN.** A missing value and a
 *    zero mean different things — an operator absent from an era did not score
 *    nothing, it was not there — and the UI must not conflate them.
 */

/** Shown wherever a value is genuinely absent. */
export const EMPTY = '—';

const DEFAULT_LOCALE: string | undefined = undefined; // follow the browser

/** Formats a ratio in [0,1] as a percentage. `0.1234` -> `12.34%`. */
export function formatPercent(
  ratio: number | null | undefined,
  { decimals = 2, signed = false }: { decimals?: number; signed?: boolean } = {},
): string {
  if (ratio == null || !Number.isFinite(ratio)) return EMPTY;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(ratio);
}

/**
 * Formats a POLYX amount. Large values are abbreviated, because a stake column
 * of full nine-digit numbers is unreadable and the extra digits carry nothing a
 * reader acts on.
 */
export function formatPolyx(
  amount: number | null | undefined,
  {
    compact = false,
    decimals = 0,
    symbol = false,
  }: {
    compact?: boolean;
    decimals?: number;
    symbol?: boolean;
  } = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return EMPTY;

  const formatted = new Intl.NumberFormat(DEFAULT_LOCALE, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : decimals,
    minimumFractionDigits: compact ? 0 : decimals,
  }).format(amount);

  return symbol ? `${formatted} POLYX` : formatted;
}

/**
 * Converts an exact base-unit string to POLYX for display.
 *
 * Balances in `latest.json` are strings precisely so they survive the trip
 * without float rounding; this is the single point where that precision is
 * traded for readability.
 */
export function formatBaseUnits(
  baseUnits: string | null | undefined,
  tokenDecimals: number,
  options: Parameters<typeof formatPolyx>[1] = {},
): string {
  if (baseUnits == null) return EMPTY;
  try {
    return formatPolyx(Number(BigInt(baseUnits)) / 10 ** tokenDecimals, options);
  } catch {
    return EMPTY;
  }
}

export function formatNumber(
  value: number | null | undefined,
  { decimals = 0, compact = false }: { decimals?: number; compact?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: decimals,
    minimumFractionDigits: compact ? 0 : decimals,
  }).format(value);
}

/**
 * Truncates an SS58 address for display.
 *
 * Both ends are kept: the leading characters identify the network prefix and
 * the trailing ones are what people actually compare when checking they have
 * the right account.
 */
export function truncateAddress(address: string, lead = 5, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Formats an era's date. Eras are the internal index; dates are what people
 * think in, so charts label with dates and keep the era index secondary.
 */
export function formatEraDate(
  unixSeconds: number | null | undefined,
  { withYear = false }: { withYear?: boolean } = {},
): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return EMPTY;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(new Date(unixSeconds * 1000));
}

export function formatDateTime(
  iso: string | null | undefined,
  /** `timeOnly` drops the date, for when the surrounding text supplies it. */
  { timeOnly = false }: { timeOnly?: boolean } = {},
): string {
  if (iso == null) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return new Intl.DateTimeFormat(
    DEFAULT_LOCALE,
    timeOnly ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' },
  ).format(date);
}

/**
 * A coarse "3 hours ago" for snapshot freshness.
 *
 * Every tier-2 value carries one of these (design doc §6.6a): a user must never
 * have to guess whether a number is current, which is exactly what the previous
 * app left them to do.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (iso == null) return EMPTY;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return EMPTY;

  const seconds = Math.round((then - now) / 1000);
  const format = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  let value = seconds;
  for (const [unit, step] of units) {
    if (Math.abs(value) < step) return format.format(Math.round(value), unit);
    value /= step;
  }
  return format.format(Math.round(value), 'year');
}

/** Formats a duration in seconds as `2d 4h` / `4h 12m` / `12m 30s`. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return EMPTY;

  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  // Two units is the readable maximum; more reads as a stopwatch, not a summary.
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
