'use client';

/**
 * A tiny trend line for stat tiles and table cells.
 *
 * Deliberately without axes, ticks or interaction: a sparkline answers "which
 * way, and how steadily?", not "what value?". Adding chrome at this size only
 * subtracts legibility, and the precise number is always adjacent anyway.
 *
 * **Deliberately free of `lib/charts/geometry`, and so of d3.** An earlier
 * version reused `valueScale` and `linePath`, which was tidier to read and
 * quietly put d3-scale + d3-shape (14.4 KB gzip) on the critical path of every
 * page carrying a stat tile — defeating the code-splitting that keeps the chart
 * kit off it. The arithmetic here is a dozen lines and needs no library.
 *
 * That matters more from Phase 5 onward: the operator table renders a sparkline
 * per row, so this is the most-instantiated chart component in the app.
 *
 * Hidden from assistive technology — the figure beside it is the accessible
 * representation, and announcing "graphic" for a 72-pixel decoration is noise.
 */
export function Sparkline({
  values,
  width = 72,
  height = 20,
  colour = 'var(--series-other)',
  strokeWidth = 1.5,
}: {
  values: readonly (number | null)[];
  width?: number | undefined;
  height?: number | undefined;
  // `| undefined` explicitly: callers routinely pass a conditional colour, and
  // exactOptionalPropertyTypes treats an absent property and an explicit
  // undefined as different things.
  colour?: string | undefined;
  strokeWidth?: number | undefined;
}) {
  const path = buildPath(values, width, height, strokeWidth);

  // One point is not a trend; render a spacer rather than a misleading dot, so
  // surrounding layout does not shift between rows that have data and rows
  // that do not.
  if (path == null) {
    return <span aria-hidden="true" style={{ display: 'inline-block', width, height }} />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="block overflow-visible"
    >
      <path d={path} fill="none" stroke={colour} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Builds the path, or null when there is nothing worth drawing.
 *
 * Gaps break the line rather than bridging it, matching the full chart kit:
 * joining across a missing era would imply continuity that did not exist.
 */
function buildPath(
  values: readonly (number | null)[],
  width: number,
  height: number,
  strokeWidth: number,
): string | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
    count += 1;
  }

  if (count < 2) return null;

  // Inset by the stroke so the line is not clipped at the extremes, and give a
  // perfectly flat series a mid-height line rather than dividing by zero.
  const inset = strokeWidth;
  const usable = Math.max(0, height - inset * 2);
  const span = hi - lo;
  const step = values.length > 1 ? width / (values.length - 1) : width;

  let path = '';
  let penDown = false;

  for (const [i, value] of values.entries()) {
    if (value == null || !Number.isFinite(value)) {
      penDown = false;
      continue;
    }
    const x = i * step;
    // SVG y grows downward, so a larger value must map to a smaller y.
    const y = span === 0 ? height / 2 : inset + (1 - (value - lo) / span) * usable;
    path += `${penDown ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    penDown = true;
  }

  return path.trim() || null;
}
