'use client';

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  bandPath,
  DIRECT_LABEL_MIN_WIDTH,
  gutterFor,
  linePath,
  logValueScale,
  nearestIndex,
  plotBox,
  positiveOrNull,
  responsiveMargin,
  spreadLabels,
  tickCount,
  timeScale,
  valueScale,
} from '@/lib/charts/geometry';
import { MAX_NAMED_SERIES, SERIES_TOKENS } from '@/lib/charts/palette';
import { useMeasuredWidth } from '@/lib/charts/use-measure';
import { formatEraDate } from '@/lib/format';
import { Grid, XAxis, YAxis } from './axes';
import { useChartHeight } from './chart-frame';

/**
 * The banded multi-series line chart.
 *
 * This is the form that replaces the previous app's operator charts, and it is
 * the single most important visual change in the rebuild. Those drew ~100
 * series coloured by `d3.interpolateTurbo(index / count)` at 0.2 opacity with a
 * 100-row legend, which fails several ways at once: a *sequential* ramp used
 * for *categorical* identity, hues assigned by array position so filtering
 * repaints every survivor, ~100 colours nobody can distinguish, and identity
 * carried by colour alone.
 *
 * Four layers instead, bottom to top:
 *
 *   1. the p10–p90 band across all operators — what "normal" looked like;
 *   2. the median, dashed;
 *   3. a reference line (the network average), direct-labelled;
 *   4. up to eight selected operators in fixed palette order, direct-labelled.
 *
 * The information a reader actually wants — *how is my operator doing versus
 * the field?* — is then legible, which it never was before.
 *
 * Accessibility: the SVG carries a generated summary, arrow keys walk the x
 * axis announcing values through a live region, and the caller supplies a table
 * rendering of the same data. Colour is never the only channel.
 */

export interface NamedSeries {
  /** Stable identity — the operator address. Colour follows this, not rank. */
  id: string;
  label: string;
  values: readonly (number | null)[];
}

export interface BandSeries {
  lo: readonly (number | null)[];
  mid: readonly (number | null)[];
  hi: readonly (number | null)[];
  label: string;
}

export interface BandedLineChartProps {
  eras: readonly number[];
  eraStart: readonly number[];
  series: readonly NamedSeries[];
  band?: BandSeries | undefined;
  reference?: { values: readonly (number | null)[]; label: string } | undefined;
  /** Formats a value for ticks, tooltip and announcements. */
  format: (value: number | null) => string;
  yLabel?: string | undefined;
  height?: number;
  includeZero?: boolean;
  /**
   * Hard ceiling for the y axis. Marks above it are clipped, not dropped.
   *
   * For a series with a bootstrap outlier that would otherwise own the axis —
   * see `ValueScaleOptions.max`. A caller setting this must say so in the
   * chart's coverage line, and the table view still carries the real values.
   */
  yMax?: number | undefined;
  /**
   * `log` for a series spanning orders of magnitude.
   *
   * A validator's first era pays a return like nothing that follows it — its
   * own bond, no nominators, a full share of points. Linear either lets that
   * point own the axis or clips it away; log shows it *and* the ordinary range
   * on the same plot. Non-positive values become gaps, which is what they mean.
   */
  scaleType?: 'linear' | 'log' | undefined;
  /**
   * Terser formatter for axis ticks. Falls back to `format`, but an axis wants
   * "20%" where a tooltip wants "19.81%" — the extra digits are noise repeated
   * down the gutter.
   */
  tickFormat?: ((value: number) => string) | undefined;
}

export function BandedLineChart({
  eras,
  eraStart,
  series,
  band,
  reference,
  format,
  yLabel,
  height: requestedHeight = 320,
  includeZero = false,
  yMax,
  scaleType = 'linear',
  tickFormat,
}: BandedLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  /**
   * Drawn at the container's real pixel width, not a fixed viewBox scaled to
   * 100%. Scaling a viewBox shrinks the *text* along with the marks, so an 11px
   * axis label becomes ~4px on a phone — the same illegibility the previous app
   * fought with a JS font-size ladder. Measuring instead keeps type at its
   * natural size at every breakpoint.
   */
  const [containerRef, measuredWidth] = useMeasuredWidth<HTMLDivElement>();
  const width = measuredWidth ?? 0;
  const baseMargin = responsiveMargin(width);
  const showDirectLabels = width >= DIRECT_LABEL_MIN_WIDTH;
  // Taller when the frame is expanded. This is the chart that most needs it:
  // eight operators over ninety eras is a thicket in a page-width card, and
  // vertical room separates the lines as much as horizontal room does.
  const height = useChartHeight(requestedHeight);

  const logarithmic = scaleType === 'log';
  const formatTick = useMemo(() => tickFormat ?? ((v: number) => format(v)), [tickFormat, format]);

  /**
   * The scale and the plot box, together, because each needs the other.
   *
   * `innerHeight` depends only on the top and bottom margins, so the y scale
   * can be built against a provisional box. The tick labels it then produces
   * are what decide how wide the left gutter has to be — without that pass a
   * "10,000%" tick renders as "0,000%", which does not merely look wrong, it
   * reads as a different number.
   *
   * One memo rather than two plus loose intermediates: the React Compiler
   * cannot preserve memoization across a plain object built mid-render, and
   * bailed out of optimising this component entirely when it was written that
   * way.
   */
  const { box, y } = useMemo(() => {
    const provisional = plotBox(width, height, baseMargin);

    const columns: (readonly (number | null)[])[] = series.map((s) => s.values);
    if (band) columns.push(band.lo, band.hi);
    if (reference) columns.push(reference.values);

    const scale = logarithmic
      ? logValueScale(columns, provisional.innerHeight, {
          ...(yMax != null ? { max: yMax } : {}),
        })
      : valueScale(columns, provisional.innerHeight, {
          includeZero,
          ...(yMax != null ? { max: yMax } : {}),
        });

    const margin = {
      ...baseMargin,
      left: gutterFor(
        scale.ticks(tickCount(provisional.innerHeight, 48)),
        formatTick,
        baseMargin.left,
      ),
    };

    return { box: plotBox(width, height, margin), y: scale };
  }, [
    width,
    height,
    baseMargin,
    series,
    band,
    reference,
    includeZero,
    yMax,
    logarithmic,
    formatTick,
  ]);

  const x = useMemo(() => timeScale(eraStart, box.innerWidth), [eraStart, box.innerWidth]);

  /**
   * Places a value on the axis, or returns null for a gap.
   *
   * On a log axis zero and negatives have nowhere to go — `y(0)` is -Infinity,
   * which would drag a line off the plot rather than break it. Routing every
   * plotted value through here keeps that decision in one place.
   */
  const at = useCallback(
    (value: number | null | undefined): number | null => {
      const usable = logarithmic ? positiveOrNull(value) : (value ?? null);
      return usable == null ? null : y(usable);
    },
    [y, logarithmic],
  );

  const xs = useMemo(() => eraStart.map((seconds) => x(new Date(seconds * 1000))), [eraStart, x]);

  const capped = series.slice(0, MAX_NAMED_SERIES);
  const overflow = series.length - capped.length;

  // ---- interaction --------------------------------------------------------

  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Drawn 1:1, so client px map straight to chart coordinates.
      setFocusIndex(nearestIndex(xs, event.clientX - rect.left - box.margin.left));
    },
    [xs, box.margin.left],
  );

  const handleKey = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>) => {
      if (eras.length === 0) return;
      const current = focusIndex ?? eras.length - 1;

      const next = {
        ArrowRight: Math.min(current + 1, eras.length - 1),
        ArrowLeft: Math.max(current - 1, 0),
        Home: 0,
        End: eras.length - 1,
      }[event.key];

      if (next == null) return;
      event.preventDefault();
      setFocusIndex(next);
    },
    [eras.length, focusIndex],
  );

  const active = focusIndex != null && focusIndex >= 0 ? focusIndex : null;

  // ---- accessible summary -------------------------------------------------

  const summary = useMemo(() => {
    const range =
      eraStart.length > 0
        ? `${formatEraDate(eraStart[0], { withYear: true })} to ${formatEraDate(eraStart.at(-1), { withYear: true })}`
        : 'no data';
    const names = capped.map((s) => s.label).join(', ');
    return `Line chart over ${range}, ${eras.length} eras. ${
      capped.length > 0 ? `Showing ${names}.` : 'No operators selected.'
    }${band ? ` Shaded band shows ${band.label}.` : ''} Use arrow keys to read values.`;
  }, [eraStart, eras.length, capped, band]);

  const announcement =
    active == null
      ? ''
      : [
          formatEraDate(eraStart[active], { withYear: true }),
          `era ${eras[active]}`,
          ...capped.map((s) => `${s.label} ${format(s.values[active] ?? null)}`),
          reference ? `${reference.label} ${format(reference.values[active] ?? null)}` : '',
        ]
          .filter(Boolean)
          .join(', ');

  // Nothing to draw until the container has been measured. Rendering at a
  // guessed width would paint once and then visibly reflow.
  if (width <= 0) {
    return <div ref={containerRef} style={{ height }} aria-hidden="true" />;
  }

  return (
    <div ref={containerRef} className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        onPointerMove={handlePointer}
        onPointerLeave={() => setFocusIndex(null)}
        onKeyDown={handleKey}
        onBlur={() => setFocusIndex(null)}
        className="block touch-none focus-visible:outline-2"
        style={{ outlineColor: 'var(--focus-ring)', outlineOffset: 2 }}
      >
        <title id={titleId}>{summary}</title>

        {/* A clip, so a capped axis crops the marks at the plot edge instead
            of letting them draw up through the title. Only defined when a cap
            is in force — an unclipped plot is the normal case, and direct
            labels in the right gutter must not be cropped. */}
        {yMax != null ? (
          <defs>
            <clipPath id={`${titleId}-clip`}>
              <rect x={0} y={0} width={box.innerWidth} height={box.innerHeight} />
            </clipPath>
          </defs>
        ) : null}

        <g transform={`translate(${box.margin.left}, ${box.margin.top})`}>
          <Grid box={box} yScale={y} />

          {/* Layers 1-4 are the only things a y-axis cap may crop. The axis
              labels sit in the left gutter and the direct labels in the right,
              both outside the plot box, so clipping the whole group would
              erase the chart's own annotations along with the outlier. */}
          <g {...(yMax != null ? { clipPath: `url(#${titleId}-clip)` } : {})}>
            {/* 1 — distribution band */}
            {band ? (
              <path
                d={bandPath(
                  eras
                    .map((_, i) => ({
                      x: xs[i] ?? 0,
                      lo: band.lo[i] ?? null,
                      hi: band.hi[i] ?? null,
                    }))
                    .map((p) => ({
                      x: p.x,
                      lo: at(p.lo),
                      hi: at(p.hi),
                    })),
                )}
                fill="var(--band-fill)"
                aria-hidden="true"
              />
            ) : null}

            {/* 2 — median */}
            {band ? (
              <path
                d={linePath(
                  eras.map((_, i) => ({
                    x: xs[i] ?? 0,
                    y: at(band.mid[i]),
                  })),
                )}
                fill="none"
                stroke="var(--series-other)"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                aria-hidden="true"
              />
            ) : null}

            {/* 3 — reference */}
            {reference ? (
              <path
                d={linePath(
                  eras.map((_, i) => ({
                    x: xs[i] ?? 0,
                    y: at(reference.values[i]),
                  })),
                )}
                fill="none"
                stroke="var(--text-secondary)"
                strokeWidth={2}
                strokeDasharray="6 4"
                aria-hidden="true"
              />
            ) : null}

            {/* 4 — named series. Drawn last so they sit above the context. */}
            {capped.map((s, index) => {
              const colour = SERIES_TOKENS[index]!;
              const d = linePath(
                eras.map((_, i) => ({
                  x: xs[i] ?? 0,
                  y: at(s.values[i]),
                })),
              );
              return (
                <g key={s.id} aria-hidden="true">
                  {/* A surface-coloured casing under each line, so crossings read
                    as one line passing over another rather than merging. */}
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--surface-1)"
                    strokeWidth={5}
                    strokeLinecap="round"
                  />
                  <path d={d} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" />
                </g>
              );
            })}
          </g>

          {/* Crosshair */}
          {active != null ? (
            <g aria-hidden="true">
              <line
                x1={xs[active]}
                x2={xs[active]}
                y1={0}
                y2={box.innerHeight}
                stroke="var(--axis)"
                strokeWidth={1}
              />
              {capped.map((s, index) => {
                const value = s.values[active];
                if (value == null) return null;
                return (
                  <circle
                    key={s.id}
                    cx={xs[active]}
                    cy={at(value) ?? 0}
                    r={4}
                    fill={SERIES_TOKENS[index]}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          ) : null}

          {/* Direct labels, so identity is never colour-only.
              Nudged apart vertically: without that, operators whose latest
              values are close overprint each other into illegibility. Dropped
              entirely on narrow viewports, where the legend and table carry
              identity instead of a 28%-of-width label gutter. */}
          {showDirectLabels
            ? spreadLabels(
                capped.slice(0, 4).map((s) => {
                  const last = lastDefined(s.values);
                  return last == null ? null : at(last.value);
                }),
                13,
                { top: 0, bottom: box.innerHeight },
              ).map(({ index, y: labelY }) => (
                <text
                  key={capped[index]!.id}
                  x={box.innerWidth + 8}
                  y={labelY}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill={SERIES_TOKENS[index]}
                  aria-hidden="true"
                >
                  {truncateLabel(capped[index]!.label, 14)}
                </text>
              ))
            : null}

          <YAxis
            box={box}
            scale={y}
            // The same formatter the gutter was sized from, or the width and
            // the labels could disagree. Terser than the tooltip by design:
            // "20%" down the gutter, "19.81%" where precision is wanted.
            format={formatTick}
            {...(yLabel ? { label: yLabel } : {})}
          />
          <XAxis box={box} scale={x} />
        </g>
      </svg>

      {/* Tooltip. Positioned in CSS percentages so it tracks the scaled SVG. */}
      {active != null ? (
        <div
          role="presentation"
          className="pointer-events-none absolute top-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-xs shadow-[var(--shadow-md)]"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface-2)',
            // Flip to the left of the crosshair past the midpoint so the
            // tooltip never runs off the right edge.
            left: (xs[active] ?? 0) + box.margin.left,
            transform:
              ((xs[active] ?? 0) + box.margin.left) / width > 0.6
                ? 'translateX(-100%) translateX(-12px)'
                : 'translateX(12px)',
          }}
        >
          <p className="m-0 font-semibold">{formatEraDate(eraStart[active], { withYear: true })}</p>
          <p className="m-0 mb-1" style={{ color: 'var(--text-muted)' }}>
            era {eras[active]}
          </p>
          <dl className="m-0 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            {capped.map((s, index) => (
              <TooltipRow
                key={s.id}
                swatch={SERIES_TOKENS[index]!}
                label={s.label}
                value={format(s.values[active] ?? null)}
              />
            ))}
            {reference ? (
              <TooltipRow
                swatch="var(--text-secondary)"
                label={reference.label}
                value={format(reference.values[active] ?? null)}
                dashed
              />
            ) : null}
          </dl>
        </div>
      ) : null}

      {/* Keyboard navigation is useless without spoken output. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {overflow > 0 ? (
        <p className="mt-2 mb-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          {overflow} more selected {overflow === 1 ? 'operator is' : 'operators are'} not drawn —
          the chart shows at most {MAX_NAMED_SERIES}. See the table for all of them.
        </p>
      ) : null}
    </div>
  );
}

function TooltipRow({
  swatch,
  label,
  value,
  dashed = false,
}: {
  swatch: string;
  label: string;
  value: string;
  dashed?: boolean;
}) {
  return (
    <>
      <dt className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-0.5 w-3 shrink-0"
          style={
            dashed
              ? {
                  backgroundImage: `repeating-linear-gradient(90deg, ${swatch} 0 3px, transparent 3px 6px)`,
                }
              : { background: swatch }
          }
        />
        {/* Text wears text tokens; the swatch beside it carries identity. */}
        <span style={{ color: 'var(--text-secondary)' }}>{truncateLabel(label)}</span>
      </dt>
      <dd className="m-0 text-right font-medium tabular">{value}</dd>
    </>
  );
}

function lastDefined(values: readonly (number | null)[]): { index: number; value: number } | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) return { index: i, value };
  }
  return null;
}

function truncateLabel(label: string, max = 18): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}
