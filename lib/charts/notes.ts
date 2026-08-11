/**
 * Coverage notes that keep a truncated axis honest.
 *
 * Several network series barely move as a fraction of their own magnitude —
 * measured over eras 1664–1749, reward points vary by 0.8% of their maximum,
 * the validator set by 5.5%, the payout by 4.4%. Forcing those onto a
 * zero-based axis draws a flat line across the top of the plot and hides the
 * only thing the chart is for: an era where nodes went offline shows up as two
 * pixels of dip.
 *
 * Scaling to the data fixes that, and introduces the opposite hazard — a
 * truncated axis makes a 0.8% wobble look like a crisis. The tick labels do say
 * so, but only to a reader who checks them. This states it in words, with the
 * real numbers, so the chart cannot overstate its own volatility.
 *
 * Bars are exempt and must stay zero-based: a bar encodes value as *area*, so
 * cutting the axis rescales the comparison itself rather than just the view.
 * Lines encode position, which is why they can honestly start elsewhere.
 */

/**
 * "Between X and Y over this range — the axis is scaled to that, not to zero."
 *
 * Returns null when there is nothing worth saying: no data, or a series that
 * never moves, where a note about the axis would be more confusing than the
 * flat line it describes.
 */
export function axisRangeNote(
  values: readonly (number | null | undefined)[],
  format: (value: number) => string,
): string | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }

  if (!Number.isFinite(lo) || lo === hi) return null;

  return (
    `Between ${format(lo)} and ${format(hi)} over this range. The axis is scaled to that, ` +
    `not to zero, so the changes are visible — read the values, not the height of the line.`
  );
}
