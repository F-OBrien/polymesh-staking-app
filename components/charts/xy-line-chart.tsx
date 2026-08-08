'use client';

import { useId, useMemo } from 'react';
import {
  DIRECT_LABEL_MIN_WIDTH,
  linePath,
  numericScale,
  plotBox,
  responsiveMargin,
  spreadLabels,
  tickCount,
  valueScale,
} from '@/lib/charts/geometry';
import { SERIES_TOKENS } from '@/lib/charts/palette';
import { useMeasuredWidth } from '@/lib/charts/use-measure';
import { Grid, YAxis } from './axes';
import { ChartFrame } from './chart-frame';
import { Legend, type LegendItem } from './legend';

/**
 * A line chart over a numeric x axis.
 *
 * Sibling to `BandedLineChart`, not a replacement for it. That one is
 * era-indexed and carries a distribution band, focus tracking and keyboard
 * traversal of history, all of which assume x is time. This one exists for the
 * one chart in the app whose x axis is a *quantity* — the slashing penalty
 * curves, indexed by how many validators offend at once.
 *
 * Deliberately simpler: these curves are smooth analytic functions with no
 * gaps, no missing eras and no per-point identity worth focusing. Reading a
 * precise value off them matters less than seeing their shape, and the exact
 * numbers are in the table view that `ChartFrame` requires anyway.
 */

export interface XySeries {
  id: string;
  label: string;
  values: readonly number[];
}

export interface XyLineChartProps {
  /** Shared x values. Every series must align with these by index. */
  x: readonly number[];
  series: readonly XySeries[];
  title: string;
  subtitle?: string | undefined;
  xLabel: string;
  yLabel?: string | undefined;
  format: (value: number) => string;
  tickFormat?: ((value: number) => string) | undefined;
  /** Formats an x value for ticks and the table's first column. */
  formatX?: ((value: number) => string) | undefined;
  height?: number;
  loading?: boolean | undefined;
  error?: Error | null | undefined;
}

export function XyLineChart({
  x,
  series,
  title,
  subtitle,
  xLabel,
  yLabel,
  format,
  tickFormat,
  formatX = String,
  height = 300,
  loading = false,
  error,
}: XyLineChartProps) {
  const titleId = useId();
  const [containerRef, measuredWidth] = useMeasuredWidth<HTMLDivElement>();

  const width = measuredWidth ?? 0;
  const margin = responsiveMargin(width);
  const box = plotBox(width, height, margin);
  const showDirectLabels = width >= DIRECT_LABEL_MIN_WIDTH;

  const xScale = useMemo(() => numericScale(x, box.innerWidth), [x, box.innerWidth]);
  const yScale = useMemo(
    () =>
      valueScale(
        series.map((s) => s.values),
        box.innerHeight,
        { includeZero: true },
      ),
    [series, box.innerHeight],
  );

  const xs = useMemo(() => x.map((value) => xScale(value)), [x, xScale]);

  // `linePath` works in pixel space, so values must go through the scale first.
  // Passing raw ratios drew every curve as a flat line within a pixel of the
  // top of the plot — and the direct labels, which did scale, still landed in
  // the right places, so it looked like a data problem rather than a bug here.
  const paths = useMemo(
    () =>
      series.map((s) =>
        linePath(s.values.map((value, i) => ({ x: xs[i] ?? 0, y: yScale(value) }))),
      ),
    [series, xs, yScale],
  );

  // Placed at each curve's final value, then nudged apart — two curves that
  // both saturate at 100% would otherwise print their labels on top of one
  // another, which is how the previous app's charts became unreadable.
  const labels = useMemo(() => {
    if (!showDirectLabels) return [];
    const desired = series.map((s) => yScale(s.values.at(-1) ?? 0));
    return spreadLabels(desired, 14, { top: 0, bottom: box.innerHeight });
  }, [series, showDirectLabels, yScale, box.innerHeight]);

  const legend: LegendItem[] = series.map((s) => ({ id: s.id, label: s.label }));

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      height={height}
      loading={loading}
      error={error}
      legend={showDirectLabels ? undefined : <Legend items={legend} />}
      table={
        <table
          className="w-full border-collapse text-sm"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <caption className="sr-only">{title}, as a table</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1.5 text-left font-medium">
                {xLabel}
              </th>
              {series.map((s) => (
                <th key={s.id} scope="col" className="p-1.5 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {x.map((value, i) => (
              <tr key={value} style={{ borderTop: '1px solid var(--border)' }}>
                <th scope="row" className="p-1.5 text-left font-normal">
                  {formatX(value)}
                </th>
                {series.map((s) => (
                  <td key={s.id} className="p-1.5 text-right">
                    {format(s.values[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div ref={containerRef} className="w-full">
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-labelledby={titleId}
            className="block overflow-visible"
          >
            <title id={titleId}>
              {`${title}. ${series
                .map((s) => `${s.label} rises to ${format(Math.max(...s.values))}`)
                .join('. ')}.`}
            </title>

            <g transform={`translate(${margin.left}, ${margin.top})`}>
              <Grid box={box} yScale={yScale} />
              <YAxis box={box} scale={yScale} format={tickFormat ?? format} label={yLabel} />

              {/* A quantity axis, so ticks are counts and the label names the
                  unit — `XAxis` formats dates and would be wrong here. */}
              <g aria-hidden="true" transform={`translate(0, ${box.innerHeight})`}>
                <line
                  x1={0}
                  x2={box.innerWidth}
                  y1={0}
                  y2={0}
                  stroke="var(--axis)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {xScale.ticks(tickCount(box.innerWidth, 90)).map((tick) => (
                  <text
                    key={tick}
                    x={xScale(tick)}
                    y={16}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--text-muted)"
                  >
                    {formatX(tick)}
                  </text>
                ))}
                <text
                  x={box.innerWidth / 2}
                  y={32}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-muted)"
                >
                  {xLabel}
                </text>
              </g>

              {paths.map((d, i) => (
                <path
                  key={series[i]!.id}
                  d={d}
                  fill="none"
                  stroke={SERIES_TOKENS[i % SERIES_TOKENS.length]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}

              {labels.map(({ index, y }) => (
                <text
                  key={series[index]!.id}
                  x={box.innerWidth + 8}
                  y={y}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill={SERIES_TOKENS[index % SERIES_TOKENS.length]}
                >
                  {series[index]!.label}
                </text>
              ))}
            </g>
          </svg>
        ) : (
          // Reserves height on the first paint, before the container is
          // measured, so the frame does not resize under the reader.
          <div style={{ height }} />
        )}
      </div>
    </ChartFrame>
  );
}
