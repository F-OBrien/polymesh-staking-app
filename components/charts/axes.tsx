'use client';

import { tickCount, type LinearScale, type PlotBox, type TimeScale } from '@/lib/charts/geometry';

/**
 * Axes and grid.
 *
 * Recessive by design: hairline grid, muted labels, no chart-area border, no
 * axis line on the value side. Chrome should be legible when looked for and
 * invisible otherwise — the data is the thing with contrast.
 *
 * All chrome is `aria-hidden`: the accessible representation of a chart is its
 * table, and announcing every gridline would be noise.
 */

export function Grid({ box, yScale }: { box: PlotBox; yScale: LinearScale }) {
  const ticks = yScale.ticks(tickCount(box.innerHeight, 48));

  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <line
          key={tick}
          x1={0}
          x2={box.innerWidth}
          y1={yScale(tick)}
          y2={yScale(tick)}
          stroke="var(--gridline)"
          strokeWidth={1}
          // Horizontal only. Vertical gridlines on a time axis add clutter
          // without helping anyone read a value off the chart.
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  );
}

export function YAxis({
  box,
  scale,
  format,
  label,
}: {
  box: PlotBox;
  scale: LinearScale;
  format: (value: number) => string;
  label?: string;
}) {
  const ticks = scale.ticks(tickCount(box.innerHeight, 48));

  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <text
          key={tick}
          x={-8}
          y={scale(tick)}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={11}
          fill="var(--text-muted)"
          // Tabular figures so tick labels form a clean right-aligned column.
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {format(tick)}
        </text>
      ))}
      {/* The unit sits horizontally above the axis rather than rotated beside
          it. Rotated text is harder to read, and at narrow left margins it
          collided with the tick labels it was meant to describe. */}
      {label ? (
        <text x={-8} y={-8} textAnchor="end" fontSize={10} fill="var(--text-muted)">
          {label}
        </text>
      ) : null}
    </g>
  );
}

/**
 * The x axis: dates, not era indices.
 *
 * The previous app labelled every axis with a raw era number. An era is a day,
 * so era 1403 *is* a date — but the reader had to know the mapping. Nobody
 * thinks in era indices; the index stays in the tooltip and the table.
 */
export function XAxis({ box, scale }: { box: PlotBox; scale: TimeScale }) {
  const ticks = scale.ticks(tickCount(box.innerWidth, 90));
  const format = scale.tickFormat();

  return (
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
      {ticks.map((tick) => (
        <text
          key={tick.getTime()}
          x={scale(tick)}
          y={16}
          textAnchor="middle"
          fontSize={11}
          fill="var(--text-muted)"
        >
          {format(tick)}
        </text>
      ))}
    </g>
  );
}

/**
 * A dashed reference line, e.g. the network average or an ideal target.
 *
 * Direct-labelled at the right edge rather than relegated to the legend: a
 * reference line is the thing every other series is read against, so its
 * identity should not require a lookup.
 */
export function ReferenceLine({
  box,
  y,
  label,
  colour = 'var(--text-secondary)',
}: {
  box: PlotBox;
  y: number;
  label?: string;
  colour?: string;
}) {
  return (
    <g aria-hidden="true">
      <line
        x1={0}
        x2={box.innerWidth}
        y1={y}
        y2={y}
        stroke={colour}
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      {label ? (
        <text x={box.innerWidth + 8} y={y} dominantBaseline="middle" fontSize={11} fill={colour}>
          {label}
        </text>
      ) : null}
    </g>
  );
}
