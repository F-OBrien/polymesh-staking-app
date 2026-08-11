'use client';

import { useId, useMemo, useState } from 'react';
import { linePath, plotBox, responsiveMargin, timeScale, valueScale } from '@/lib/charts/geometry';
import { useMeasuredWidth } from '@/lib/charts/use-measure';
import { formatEraDate } from '@/lib/format';
import { Grid, XAxis, YAxis } from './axes';
import { ChartFrame, useChartHeight } from './chart-frame';

/**
 * Bars over a time axis, with an optional companion panel below.
 *
 * The chart kit had no way to draw a bar at all — axes, a banded line, an xy
 * line, a sparkline and a table, and nothing else. That gap is why five charts
 * in the §8.3 catalogue were never built and why "rewards per era", specced as
 * a bar, shipped as a line.
 *
 * **Two panels, never two y-axes.** A per-period amount and its running total
 * differ by orders of magnitude, and §8.1 rule 2 is explicit: two measures of
 * different scale get two stacked charts sharing an x-axis, not a second axis.
 * Dual axes let any correlation be manufactured by rescaling, which is exactly
 * what this site exists not to do.
 *
 * The bars are the primary series and the companion is a line, because a
 * cumulative total is a level rather than a set of discrete events — drawing it
 * as bars would imply each period contained the whole running sum.
 */

export interface TimeBarChartProps {
  /** Unix seconds, one per bar, ascending. */
  times: readonly number[];
  values: readonly (number | null)[];
  title: string;
  subtitle?: string | undefined;
  coverage?: string | undefined;
  /** Controls for the frame's header, e.g. a grouping selector. */
  actions?: React.ReactNode;
  /** Label for the bars' y axis. */
  yLabel?: string | undefined;
  format: (value: number | null) => string;
  tickFormat?: ((value: number) => string) | undefined;
  /** A running total, or any level worth showing under the bars. */
  companion?:
    | {
        values: readonly (number | null)[];
        label: string;
        format?: ((value: number | null) => string) | undefined;
      }
    | undefined;
  height?: number;
  loading?: boolean | undefined;
  error?: Error | null | undefined;
  empty?: React.ReactNode;
}

export function TimeBarChart({
  times,
  values,
  title,
  subtitle,
  coverage,
  actions,
  yLabel,
  format,
  tickFormat,
  companion,
  height: requestedHeight = 260,
  loading = false,
  error,
  empty,
}: TimeBarChartProps) {
  const titleId = useId();
  const [containerRef, measuredWidth] = useMeasuredWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<number | null>(null);

  const height = useChartHeight(requestedHeight);
  const width = measuredWidth ?? 0;

  // The companion takes the lower third: it is context for the bars, not a
  // peer, and a running total needs less room to read than a set of events.
  const companionHeight = companion ? Math.round(height * 0.34) : 0;
  const barsHeight = height - companionHeight;

  const margin = responsiveMargin(width);
  const barsBox = plotBox(width, barsHeight, {
    ...margin,
    // No right gutter: nothing is direct-labelled here, and the bars should
    // use the full width.
    right: 16,
    bottom: companion ? 4 : margin.bottom,
  });
  const companionBox = plotBox(width, companionHeight, { ...margin, right: 16 });

  const x = useMemo(() => timeScale(times, barsBox.innerWidth), [times, barsBox.innerWidth]);
  const y = useMemo(
    () => valueScale([values], barsBox.innerHeight, { includeZero: true, min: 0 }),
    [values, barsBox.innerHeight],
  );
  const companionY = useMemo(
    () =>
      companion
        ? valueScale([companion.values], companionBox.innerHeight, { includeZero: true, min: 0 })
        : null,
    [companion, companionBox.innerHeight],
  );

  const xs = useMemo(() => times.map((t) => x(new Date(t * 1000))), [times, x]);

  /**
   * Bar width from the *median* gap, not the mean.
   *
   * A reward history commonly has one enormous gap — an account that stopped
   * staking for a year — and a mean gap would size every bar for that outlier,
   * rendering the dense region as invisible hairlines.
   */
  const barWidth = useMemo(() => {
    if (xs.length < 2) return Math.min(24, barsBox.innerWidth / 2);
    const gaps = xs
      .slice(1)
      .map((v, i) => v - (xs[i] ?? 0))
      .filter((g) => g > 0)
      .sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)] ?? 8;
    return Math.max(1, Math.min(median * 0.7, 40));
  }, [xs, barsBox.innerWidth]);

  const companionPath = useMemo(() => {
    if (!companion || !companionY) return '';
    const points = companion.values
      .map((value, i) => (value == null ? null : { x: xs[i] ?? 0, y: companionY(value) }))
      .filter((p): p is { x: number; y: number } => p != null);
    return linePath(points);
  }, [companion, companionY, xs]);

  const table = (
    <table
      className="w-full border-collapse text-sm"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <caption className="sr-only">{title}, as a table</caption>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th scope="col" className="p-2 text-left font-medium">
            Date
          </th>
          <th scope="col" className="p-2 text-right font-medium">
            {yLabel ?? 'Value'}
          </th>
          {companion ? (
            <th scope="col" className="p-2 text-right font-medium">
              {companion.label}
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {times.map((time, i) => (
          <tr key={time} style={{ borderTop: '1px solid var(--border)' }}>
            <th scope="row" className="p-2 text-left font-normal">
              {formatEraDate(time, { withYear: true })}
            </th>
            <td className="p-2 text-right">{format(values[i] ?? null)}</td>
            {companion ? (
              <td className="p-2 text-right">
                {(companion.format ?? format)(companion.values[i] ?? null)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const focused = focus != null ? focus : null;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      coverage={coverage}
      actions={actions}
      height={requestedHeight}
      loading={loading}
      error={error}
      empty={empty}
      table={table}
    >
      <div ref={containerRef} className="w-full">
        {width > 0 ? (
          <>
            <svg
              width={width}
              height={barsHeight}
              role="img"
              aria-labelledby={titleId}
              className="block overflow-visible"
              onMouseLeave={() => setFocus(null)}
            >
              <title id={titleId}>{`${title}. ${times.length} periods.`}</title>

              <g transform={`translate(${barsBox.margin.left}, ${barsBox.margin.top})`}>
                <Grid box={barsBox} yScale={y} />
                <YAxis
                  box={barsBox}
                  scale={y}
                  format={tickFormat ?? ((v) => format(v))}
                  label={yLabel}
                />

                {values.map((value, i) => {
                  if (value == null) return null;
                  const top = y(value);
                  const zero = y(0);
                  const cx = xs[i] ?? 0;
                  return (
                    <rect
                      key={times[i]}
                      x={cx - barWidth / 2}
                      y={Math.min(top, zero)}
                      width={barWidth}
                      height={Math.max(1, Math.abs(zero - top))}
                      rx={Math.min(2, barWidth / 3)}
                      fill="var(--series-1)"
                      opacity={focused == null || focused === i ? 1 : 0.35}
                      onMouseEnter={() => setFocus(i)}
                    />
                  );
                })}
              </g>

              {!companion ? (
                <g transform={`translate(${barsBox.margin.left}, ${barsBox.margin.top})`}>
                  <XAxis box={barsBox} scale={x} />
                </g>
              ) : null}
            </svg>

            {companion && companionY ? (
              <svg
                width={width}
                height={companionHeight}
                role="presentation"
                className="block overflow-visible"
              >
                <g transform={`translate(${companionBox.margin.left}, ${companionBox.margin.top})`}>
                  <YAxis
                    box={companionBox}
                    scale={companionY}
                    format={(v) => (companion.format ?? format)(v)}
                    label={companion.label}
                  />
                  <path
                    d={companionPath}
                    fill="none"
                    stroke="var(--series-2)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  <XAxis box={companionBox} scale={x} />
                </g>
              </svg>
            ) : null}

            {/* Read out the focused bar, since the bars carry no labels. */}
            <p
              className="mt-1 mb-0 text-xs"
              style={{ color: 'var(--text-secondary)', minHeight: '1.25rem' }}
              aria-live="polite"
            >
              {focused != null && times[focused] != null
                ? `${formatEraDate(times[focused]!, { withYear: true })}: ${format(values[focused] ?? null)}${
                    companion
                      ? ` · ${companion.label} ${(companion.format ?? format)(
                          companion.values[focused] ?? null,
                        )}`
                      : ''
                  }`
                : ''}
            </p>
          </>
        ) : (
          // Reserves height before the container is measured, so nothing shifts.
          <div style={{ height }} />
        )}
      </div>
    </ChartFrame>
  );
}
