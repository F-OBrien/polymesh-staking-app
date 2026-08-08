'use client';

import { linePath, valueScale } from '@/lib/charts/geometry';

/**
 * A tiny trend line for stat tiles and table cells.
 *
 * Deliberately without axes, ticks or interaction: a sparkline answers "which
 * way, and how steadily?", not "what value?". Adding chrome at this size only
 * subtracts legibility, and the precise number is always adjacent anyway.
 *
 * Hidden from assistive technology — the figure beside it is the accessible
 * representation, and announcing "graphic" for a 60-pixel decoration is noise.
 */
export function Sparkline({
  values,
  width = 72,
  height = 20,
  colour = 'var(--series-other)',
  strokeWidth = 1.5,
}: {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  colour?: string;
  strokeWidth?: number;
}) {
  const defined = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (defined.length < 2) {
    // One point is not a trend; render nothing rather than a misleading dot.
    return <span aria-hidden="true" style={{ display: 'inline-block', width, height }} />;
  }

  // Inset by the stroke so the line is not clipped at the extremes.
  const inset = strokeWidth;
  const y = valueScale([values], height - inset * 2, { padding: 0.05 });
  const step = values.length > 1 ? width / (values.length - 1) : width;

  const d = linePath(
    values.map((value, i) => ({
      x: i * step,
      y: value == null ? null : y(value) + inset,
    })),
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="block overflow-visible"
    >
      <path d={d} fill="none" stroke={colour} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
