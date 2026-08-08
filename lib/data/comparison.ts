import type { OperatorRow } from './operator-rows';

/**
 * Building the side-by-side comparison.
 *
 * Pure, and separate from the component, for the same reason
 * `operator-rows.ts` is: "which of these is best on this metric" is a question
 * with edge cases — ties, missing values, metrics where lower wins — and every
 * one of them is a way to mislead someone choosing where to put money.
 */

/** Which direction counts as better. `none` means neither, e.g. stake size. */
export type Polarity = 'higher' | 'lower' | 'none';

export interface MetricDefinition {
  key: string;
  label: string;
  /** Short clarifier shown under the label. */
  hint?: string;
  polarity: Polarity;
  value: (row: OperatorRow) => number | null;
  format: (value: number | null) => string;
  /**
   * Absolute spread above which the metric is called out as a real difference.
   * Expressed in the metric's own units.
   */
  notableSpread?: number;
}

export interface ComparisonCell {
  address: string;
  value: number | null;
  display: string;
  /** True for the best value, and for every value tied with it. */
  best: boolean;
}

export interface ComparisonRow {
  key: string;
  label: string;
  hint: string | undefined;
  polarity: Polarity;
  cells: ComparisonCell[];
  /** Difference between the largest and smallest known value, or null. */
  spread: number | null;
  /** The metric's own threshold, carried so spreads can be ranked across units. */
  notableSpread: number | undefined;
  /** True when `spread` exceeds the metric's threshold. */
  notable: boolean;
}

/**
 * Comparison values are floats derived from era averages, so exact equality is
 * the wrong test for a tie: two operators both averaging 19.81% should both be
 * marked best rather than one winning on the fourteenth decimal.
 */
const TIE_EPSILON = 1e-9;

/**
 * Builds one row per metric, marking the best cell in each.
 *
 * Nothing is marked best when a metric has no polarity, when fewer than two
 * operators have a value for it, or when every operator ties. Highlighting a
 * "winner" among one known value and three blanks is the most misleading thing
 * this table could do.
 */
export function buildComparison(
  rows: readonly OperatorRow[],
  metrics: readonly MetricDefinition[],
): ComparisonRow[] {
  return metrics.map((metric) => {
    const values = rows.map((row) => metric.value(row));
    const known = values.filter((v): v is number => v != null && Number.isFinite(v));

    const spread = known.length >= 2 ? Math.max(...known) - Math.min(...known) : null;

    const target =
      metric.polarity === 'none' || known.length < 2
        ? null
        : metric.polarity === 'higher'
          ? Math.max(...known)
          : Math.min(...known);

    // Every operator scoring identically is not a comparison; highlighting all
    // of them says "these differ" when they do not.
    const allTied = spread != null && spread <= TIE_EPSILON;

    const cells: ComparisonCell[] = rows.map((row, i) => {
      const value = values[i] ?? null;
      return {
        address: row.address,
        value,
        display: metric.format(value),
        best:
          target != null && !allTied && value != null && Math.abs(value - target) <= TIE_EPSILON,
      };
    });

    return {
      key: metric.key,
      label: metric.label,
      hint: metric.hint,
      polarity: metric.polarity,
      cells,
      spread,
      notableSpread: metric.notableSpread,
      notable: spread != null && metric.notableSpread != null && spread > metric.notableSpread,
    };
  });
}

/**
 * The metrics whose spread is wide enough to actually inform a choice.
 *
 * The point of the callout this feeds: on most metrics, most operators are
 * indistinguishable, and a table of twelve rows invites a reader to weigh
 * differences that are noise. Naming the two or three that are not is more
 * useful than presenting all twelve as equally meaningful.
 */
export function notableDifferences(rows: readonly ComparisonRow[]): ComparisonRow[] {
  return rows.filter((row) => row.notable).sort((a, b) => severity(b) - severity(a));
}

/**
 * How far past its own threshold a spread reaches, as a multiple.
 *
 * Metrics are in different units — a commission spread of 0.1 and a nominator
 * spread of 400 cannot be compared directly — so ranking by raw spread would
 * simply sort by whichever metric has the largest numbers. Dividing by each
 * metric's threshold puts them on a common "how surprising is this" scale.
 */
function severity(row: ComparisonRow): number {
  if (row.spread == null || !row.notableSpread) return 0;
  return Math.abs(row.spread) / row.notableSpread;
}
