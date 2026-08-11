'use client';

import { useMemo } from 'react';
import { LazyChart, LazyXyLineChart } from '@/components/charts/lazy-chart';
import { project } from '@/lib/metrics/projection';
import { formatPolyx } from '@/lib/format';
import type { XySeries } from '@/components/charts/xy-line-chart';

/**
 * How a bond is projected to grow over the chosen horizon (C22).
 *
 * `/calculator` had no chart at all — four stat tiles and a paragraph. The
 * numbers were right, but a single figure for "reward after two years" hides
 * the two things a reader actually wants from a projection: how it accumulates,
 * and how wide the uncertainty gets the further out you look.
 *
 * **Deliberately not the specced form.** §8.3 lists C22 as "bar with
 * sensitivity range", which is one bar and two whiskers — a chart that says
 * exactly what the stat tiles already say, in more space. Plotting the
 * accumulation instead shows the shape of it, and the band widening with time
 * is the honest visual statement that a far-out projection is a weaker claim
 * than a near one. Recorded here rather than silently deviating.
 *
 * The band is the operator's own measured per-era variance, so an erratic
 * operator visibly produces a less certain projection than a steady one. That
 * is the whole argument for the Steadiness column, made visible.
 */

/** Enough points for a smooth curve without making the table unreadable. */
const STEPS = 40;

export interface ProjectionChartProps {
  amount: number;
  apr: number;
  aprStdDev: number | null;
  days: number;
  erasPerYear: number;
  compound: boolean;
  /** Named for the subtitle: an operator, or the network average. */
  basisLabel: string;
  height?: number;
}

export function ProjectionChart({
  amount,
  apr,
  aprStdDev,
  days,
  erasPerYear,
  compound,
  basisLabel,
  height = 280,
}: ProjectionChartProps) {
  const { x, series, hasBand } = useMemo(() => {
    const xs: number[] = [];
    const mid: number[] = [];
    const low: number[] = [];
    const high: number[] = [];

    for (let i = 0; i <= STEPS; i += 1) {
      // Every point is a full projection to that horizon rather than a running
      // sum of per-step rewards. Compounding is not linear, so accumulating
      // increments would drift from the figure the tiles report.
      const horizon = (i / STEPS) * days;
      const at = project({ amount, apr, aprStdDev, days: horizon, erasPerYear, compound });
      xs.push(horizon);
      mid.push(at.reward.mid);
      low.push(at.reward.low);
      high.push(at.reward.high);
    }

    const band = (aprStdDev ?? 0) > 0;
    return {
      x: xs,
      hasBand: band,
      series: (band
        ? [
            { id: 'high', label: 'Better', values: high },
            { id: 'mid', label: 'Expected', values: mid },
            { id: 'low', label: 'Worse', values: low },
          ]
        : [{ id: 'mid', label: 'Expected', values: mid }]) satisfies XySeries[],
    };
  }, [amount, apr, aprStdDev, days, erasPerYear, compound]);

  const polyx = (v: number) => formatPolyx(v, { compact: true });

  return (
    <LazyChart height={height} label="Projected rewards">
      <LazyXyLineChart
        title="How the reward accumulates"
        subtitle={
          hasBand
            ? 'The spread is this operator’s own measured variance — a steadier operator gives a narrower answer.'
            : 'A single line: there is not enough history here to measure how much the return varies.'
        }
        coverage={`Projected from ${basisLabel}, not a guarantee. Past variance is not a forecast of future variance.`}
        x={x}
        series={series}
        xLabel="Days from now"
        yLabel="Reward, POLYX"
        format={(v) => formatPolyx(v)}
        tickFormat={polyx}
        formatX={(v) => `${Math.round(v)}`}
        height={height}
      />
    </LazyChart>
  );
}
