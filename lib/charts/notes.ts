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

  // Terse on purpose. This sits in a one-line coverage strip beside the frame's
  // controls, and a long sentence there wraps the header and shifts the buttons
  // down the card — the reader loses the control they were reaching for to gain
  // a sentence they had already read.
  return `Axis spans ${format(lo)}–${format(hi)}, not zero.`;
}

/**
 * A y-axis ceiling that a handful of extreme points cannot own, plus the note
 * that has to accompany it.
 *
 * The case this exists for is the network's average return over the chain's
 * whole life. Its first week paid 12,564%, because 0.08% of supply was staked
 * across three validators — genuinely what happened, and utterly unlike the
 * 249 weeks since, every one of which sits between 15% and 90%. Plotted
 * honestly the axis runs to 15,000% and the last four years are a flat line on
 * the floor.
 *
 * Capping is only honest if the reader is told, so this returns the note with
 * the cap and the caller must render both. Clipped points keep their real
 * values in the table view; nothing is dropped.
 *
 * Null when no cap is warranted, which is the normal case — a series without a
 * far outlier is left entirely alone.
 */
export function outlierCap(
  values: readonly (number | null | undefined)[],
  format: (value: number) => string,
  {
    /** How many times the median a point may reach before it is an outlier. */
    tolerance = 4,
    /**
     * Why the outliers are there, in a clause that follows "peaking at X".
     *
     * Caller-supplied because the reason differs by chart and getting it wrong
     * is worse than saying nothing: this first hardcoded "in the chain's
     * earliest weeks", which was right for the network chart and plainly wrong
     * on an operator page, where the spike is that validator's own first era.
     */
    because = '',
  }: { tolerance?: number; because?: string } = {},
): { max: number; note: string } | null {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length < 4) return null;

  const sorted = [...finite].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] as number;
  if (median <= 0) return null;

  const limit = median * tolerance;
  const above = finite.filter((v) => v > limit);
  // Only worth capping for a genuine few. If a fifth of the series is above the
  // line, that is the shape of the data and cutting it would be a lie.
  if (above.length === 0 || above.length > finite.length * 0.05) return null;

  // The cap sits just above the highest point that is *not* an outlier, so the
  // legitimate range fills the plot.
  const highestKept = Math.max(...finite.filter((v) => v <= limit));
  const max = highestKept * 1.05;
  const peak = Math.max(...above);

  return {
    max,
    // Kept to one clause for the same reason as `axisRangeNote`. The full
    // explanation is `because`, which callers keep short too.
    note: `${above.length} above ${format(max)} clipped, peaking at ${format(peak)} ${because}.`,
  };
}
