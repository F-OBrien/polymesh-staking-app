import { scaleLinear, scaleUtc } from 'd3-scale';
import { line as d3Line, area as d3Area, curveMonotoneX } from 'd3-shape';

/**
 * Chart geometry: scales, paths, and the plot box.
 *
 * Pure functions over plain numbers — no React, no DOM. That keeps the maths
 * testable, and it is the reason the chart components stay thin enough to read.
 *
 * `d3-scale` and `d3-shape` are imported as submodules. The previous app pulled
 * in the whole `d3` meta-package (~600 KB) to use two functions; a lint rule
 * now blocks that.
 */

/** Space around the plot area, for axes and labels. */
export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Default margins. The right margin is generous on purpose: direct labels sit
 * there, and they are what keeps series identity off colour alone.
 */
export const DEFAULT_MARGIN: Margin = { top: 8, right: 96, bottom: 28, left: 52 };

export interface PlotBox {
  width: number;
  height: number;
  margin: Margin;
  /** Inner dimensions, i.e. the drawable area. */
  innerWidth: number;
  innerHeight: number;
}

export function plotBox(width: number, height: number, margin: Margin = DEFAULT_MARGIN): PlotBox {
  return {
    width,
    height,
    margin,
    // Clamped at zero: a container can briefly measure smaller than its own
    // margins during layout, and a negative range makes d3 emit NaN paths.
    innerWidth: Math.max(0, width - margin.left - margin.right),
    innerHeight: Math.max(0, height - margin.top - margin.bottom),
  };
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export type LinearScale = ReturnType<typeof scaleLinear<number, number>>;
export type TimeScale = ReturnType<typeof scaleUtc<number, number>>;

/**
 * The x scale: **time, not era index**.
 *
 * Every axis in the previous app was labelled with a raw era number. An era is
 * a day, so era 1403 *is* a date — but the reader had to know the mapping.
 * Dates are primary here and the era index is secondary, shown in the tooltip.
 *
 * UTC rather than local time, so a chart looks identical wherever it is read
 * and an era boundary does not appear to drift across a timezone change.
 */
const ERA_SECONDS = 86_400;

export function timeScale(eraStartSeconds: readonly number[], innerWidth: number): TimeScale {
  const first = eraStartSeconds[0] ?? 0;
  const rawLast = eraStartSeconds.at(-1) ?? first;

  // A single era — or several sharing a timestamp — would otherwise collapse
  // the domain to a point, mapping every datum to the same x and drawing the
  // series as a vertical line. Widen by one era so it renders sensibly.
  const last = rawLast > first ? rawLast : first + ERA_SECONDS;

  return scaleUtc<number, number>()
    .domain([new Date(first * 1000), new Date(last * 1000)])
    .range([0, innerWidth]);
}

/**
 * A linear x scale, for charts whose x axis is a quantity rather than a date.
 *
 * The penalty curves on `/slashing` are indexed by *number of simultaneous
 * offenders*, which `timeScale` cannot express — feeding it fabricated
 * timestamps would render date ticks over a count.
 */
export function numericScale(values: readonly number[], innerWidth: number): LinearScale {
  const first = values[0] ?? 0;
  const rawLast = values.at(-1) ?? first;
  // As `timeScale`: a degenerate domain would map every point to one x.
  const last = rawLast > first ? rawLast : first + 1;

  return scaleLinear<number, number>().domain([first, last]).range([0, innerWidth]);
}

export interface ValueScaleOptions {
  /** Force the axis to include zero. Right for magnitudes, wrong for rates. */
  includeZero?: boolean;
  /** Fractional padding above and below the data. */
  padding?: number;
  /** Hard floor, e.g. 0 for a quantity that cannot be negative. */
  min?: number;
  /**
   * Hard ceiling, for a series with an outlier that would otherwise own the
   * axis.
   *
   * The network's average APR over the chain's whole life is the case this
   * exists for: its first week paid 12,564%, because 0.08% of supply was
   * staked across three validators. That is real, and it sets a 15,000% axis
   * that compresses the other 249 weeks — every one of them between 15% and
   * 90% — into a flat line on the floor. Callers that set this must say so;
   * marks above it are clipped, not dropped.
   */
  max?: number;
}

/**
 * The y scale, fitted to the data actually present.
 *
 * Nulls are excluded rather than treated as zero — an operator absent from an
 * era did not score nothing — and an all-null series yields a benign 0..1
 * domain instead of NaN.
 *
 * `includeZero` defaults to false because most series here are rates. Forcing
 * zero onto an APR chart that ranges 19-22% compresses every real difference
 * into the top tenth of the plot and makes the chart useless.
 */
export function valueScale(
  series: readonly (readonly (number | null)[])[],
  innerHeight: number,
  { includeZero = false, padding = 0.08, min, max }: ValueScaleOptions = {},
): LinearScale {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;

  for (const column of series) {
    for (const value of column) {
      if (value == null || !Number.isFinite(value)) continue;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }

  /**
   * Whether the data itself ever goes below zero.
   *
   * Captured here, before padding or the flat-series nudge, because both can
   * push the domain below a floor the data never crosses. A count of operators
   * ranging 3 to 108 padded by 8% asks for an axis starting at -5.4, and an
   * axis offering "-5 operators" is nonsense — as is negative stake, negative
   * points, or a negative reward. Series that genuinely go negative (a
   * deviation from a baseline, say) are unaffected: this only clamps what was
   * already non-negative.
   */
  const neverNegative = lo >= 0;

  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }

  // A flat series has zero extent; give it room so the line is not drawn on
  // the axis itself.
  if (lo === hi) {
    const nudge = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= nudge;
    hi += nudge;
  }

  // Clamp before padding, or the pad is computed from the outlier's extent and
  // the ceiling ends up nowhere near where the caller asked for it.
  const cappedHi = max != null ? Math.min(hi, max) : hi;
  const pad = (cappedHi - lo) * padding;
  let domainMin = lo - pad;
  let domainMax = cappedHi + pad;
  if (neverNegative) domainMin = Math.max(domainMin, 0);
  if (min != null) domainMin = Math.max(domainMin, min);
  if (max != null) domainMax = Math.min(domainMax, max);

  return scaleLinear<number, number>()
    .domain([domainMin, domainMax])
    .range([innerHeight, 0])
    .nice();
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface PathPoint {
  x: number;
  y: number | null;
}

/**
 * A line path that **breaks at gaps** rather than bridging them.
 *
 * `defined()` is the whole point: joining across a missing era would draw a
 * straight line through data that does not exist, implying continuity the
 * operator did not have. A break reads correctly as "not in the set".
 *
 * `curveMonotoneX` smooths without overshooting — a plain cardinal curve can
 * swing an APR line below zero between two positive points, inventing a value
 * that never occurred.
 */
export function linePath(points: readonly PathPoint[]): string {
  const generator = d3Line<PathPoint>()
    .defined((d) => d.y != null && Number.isFinite(d.y))
    .x((d) => d.x)
    .y((d) => d.y ?? 0)
    .curve(curveMonotoneX);

  return generator(points) ?? '';
}

export interface BandPoint {
  x: number;
  lo: number | null;
  hi: number | null;
}

/** The p10–p90 ribbon behind the named series. Breaks at gaps, as lines do. */
export function bandPath(points: readonly BandPoint[]): string {
  const generator = d3Area<BandPoint>()
    .defined((d) => d.lo != null && d.hi != null)
    .x((d) => d.x)
    .y0((d) => d.lo ?? 0)
    .y1((d) => d.hi ?? 0)
    .curve(curveMonotoneX);

  return generator(points) ?? '';
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

/**
 * Tick count scaled to available space.
 *
 * Chart text does not reflow, so a count that reads well at 1200px produces
 * overlapping labels at 360px. Deriving it from width is what lets one chart
 * component work at every breakpoint without a resize listener mutating
 * globals — which is how the previous app handled it.
 */
export function tickCount(pixels: number, pixelsPerTick = 80): number {
  return Math.max(2, Math.min(10, Math.floor(pixels / pixelsPerTick)));
}

/**
 * Finds the datum nearest a pointer x, for the crosshair.
 *
 * Nearest-index rather than hit-testing each mark: it always resolves to
 * something, so the tooltip never flickers out between points, and it is O(1)
 * per move rather than O(points).
 */
export function nearestIndex(xs: readonly number[], pointerX: number): number {
  if (xs.length === 0) return -1;

  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [i, x] of xs.entries()) {
    const distance = Math.abs(x - pointerX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Responsive layout
// ---------------------------------------------------------------------------

/**
 * Width below which direct labels are dropped.
 *
 * They need ~96px of right margin. On a 340px-wide phone chart that is 28% of
 * the plot spent on labels that would then be truncated to uselessness — the
 * legend above and the table view carry identity there instead.
 */
export const DIRECT_LABEL_MIN_WIDTH = 560;

/**
 * Margins scaled to the available width.
 *
 * Charts are drawn at real pixel dimensions (see `useMeasuredWidth`), so the
 * margins have to adapt rather than being scaled along with everything else.
 */
export function responsiveMargin(width: number): Margin {
  const showsDirectLabels = width >= DIRECT_LABEL_MIN_WIDTH;
  return {
    // Headroom for the unit caption above the axis, and so the topmost tick
    // label is not clipped by the SVG edge.
    top: 18,
    right: showsDirectLabels ? 96 : 12,
    bottom: 28,
    // Narrower gutter on small screens; tick labels are abbreviated to match.
    left: width < 420 ? 40 : 52,
  };
}

export interface LabelPlacement {
  index: number;
  y: number;
}

/**
 * Nudges direct labels apart so they do not overprint each other.
 *
 * Without this, operators whose latest values are close render as illegible
 * overlapping text — observed with "Greentrail 1", "KDAC 3" and "Marketlend 3"
 * stacking into "KDACtlend 3". A greedy downward pass in value order is enough:
 * labels stay in the same vertical order as their series, which is what makes
 * them matchable to the lines at all.
 *
 * @param ys desired y for each label, in the caller's series order
 * @param minGap minimum vertical separation in pixels
 * @param bounds plot area the labels must stay inside
 */
export function spreadLabels(
  ys: readonly (number | null)[],
  minGap: number,
  bounds: { top: number; bottom: number },
): LabelPlacement[] {
  const placed = ys
    .map((y, index) => ({ index, y }))
    .filter((entry): entry is LabelPlacement => entry.y != null)
    .sort((a, b) => a.y - b.y);

  // Forward pass: push each label down until it clears the previous one.
  let previous = Number.NEGATIVE_INFINITY;
  for (const entry of placed) {
    entry.y = Math.max(entry.y, previous + minGap);
    previous = entry.y;
  }

  // If the stack overflowed the bottom, push the whole run back up. Doing this
  // as a second pass rather than clamping individually preserves the ordering.
  const overflow = (placed.at(-1)?.y ?? 0) - bounds.bottom;
  if (overflow > 0) {
    for (const entry of placed) entry.y -= overflow;
  }

  // Finally clamp into the plot, accepting overlap only if there is genuinely
  // no room — better a crowded label than one drawn outside the chart.
  for (const entry of placed) {
    entry.y = Math.min(Math.max(entry.y, bounds.top), bounds.bottom);
  }

  return placed;
}
