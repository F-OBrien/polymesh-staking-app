'use client';

import { useMemo } from 'react';
import { summariseProduction } from '@/lib/metrics/production';
import { SERIES_TOKENS } from '@/lib/charts/palette';
import { formatNumber, formatPercent } from '@/lib/format';
import { LazyChart, LazyDeviationChart } from '@/components/charts/lazy-chart';
import type { DeviationItem } from '@/components/charts/deviation-chart';
import type { StitchedSeries } from '@/lib/data/series';

/**
 * Block production against what the authorship lottery predicts (C18).
 *
 * The catalogue asked for "current-era points by operator, sorted, with an
 * expected-value reference line". That chart was built and thrown away: at a
 * third of the way through era 1750 the field's spread was 12.5% against the
 * 13.4% a pure lottery predicts, and over a *complete* era it was 8.1% against
 * 7.9%. There is no operator signal in one era's points at all — only slot
 * luck — so sorting it produces a leaderboard of coin flips and a reference
 * line lends that leaderboard authority. See `lib/metrics/production.ts` for
 * the measurements.
 *
 * The question survives the chart. Accumulated over the selected era range the
 * luck averages down, and over ninety eras roughly 1.1% of genuine
 * operator-to-operator dispersion remains — small, but real, and it is missed
 * blocks, which is exactly what a nominator wants to know. So: the same
 * question, over the range, with the margin of error drawn so that "better
 * than expected" cannot be confused with "lucky".
 */

/** Two standard errors — the conventional line for "not just chance". */
const SIGMA = 2;

export interface ProductionChartProps {
  series: StitchedSeries | null | undefined;
  /** Address to display name. */
  nameOf: (address: string) => string;
  /** Pinned operators, in palette order. */
  selected: readonly string[];
  height?: number;
  loading?: boolean | undefined;
  error?: Error | null | undefined;
}

export function ProductionChart({
  series,
  nameOf,
  selected,
  height = 300,
  loading = false,
  error,
}: ProductionChartProps) {
  const summary = useMemo(() => {
    if (!series) return null;
    return summariseProduction({
      eras: series.eras,
      network: series.network,
      operators: series.operators,
    });
  }, [series]);

  const items = useMemo<DeviationItem[]>(() => {
    if (!summary) return [];
    const slotOf = new Map(selected.map((address, i) => [address, i]));

    return summary.records.map((record) => {
      const slot = slotOf.get(record.address);
      const margin = SIGMA * record.standardError;
      return {
        id: record.address,
        label: nameOf(record.address),
        value: record.ratio,
        low: 1 - margin,
        high: 1 + margin,
        detail:
          `${record.eras} era${record.eras === 1 ? '' : 's'} · ` +
          `${formatNumber(record.points)} points against ${formatNumber(Math.round(record.expected))} expected`,
        // Only the first eight pins get a colour; the palette is not cycled,
        // and a ninth would repeat a hue already in use elsewhere.
        highlight: slot != null && slot < SERIES_TOKENS.length ? SERIES_TOKENS[slot] : undefined,
      };
    });
  }, [summary, selected, nameOf]);

  const outliers = useMemo(
    () => (summary ? summary.records.filter((r) => Math.abs(r.z) > SIGMA).length : 0),
    [summary],
  );

  /**
   * What the range can actually support.
   *
   * Stated rather than implied, because it changes with the era-range control:
   * over a week the same calculation is almost pure noise, and a reader who
   * narrows the range deserves to be told the chart stopped meaning anything
   * rather than left to read the same shape as before.
   */
  const coverage = useMemo(() => {
    if (!summary || summary.records.length === 0) return undefined;
    const base =
      `${summary.eras} era${summary.eras === 1 ? '' : 's'}, ${summary.records.length} operators. ` +
      `Expected is the era's total points divided by the active set — authorship slots go per ` +
      `validator, not per unit of stake.`;

    if (summary.excessSpread == null) {
      return (
        `${base} Over this range the whole spread (±${formatPercent(summary.observedSpread, { decimals: 1 })}) ` +
        `is within what chance alone produces, so nothing here separates one operator from another. ` +
        `Widen the era range.`
      );
    }
    return (
      `${base} The field spreads ±${formatPercent(summary.observedSpread, { decimals: 1 })}, of which ` +
      `±${formatPercent(summary.luckSpread, { decimals: 1 })} is chance; ` +
      `±${formatPercent(summary.excessSpread, { decimals: 1 })} is genuine difference between operators.`
    );
  }, [summary]);

  const signed = (value: number) => formatPercent(value - 1, { decimals: 1, signed: true });

  return (
    <LazyChart height={height} label="Block production against expected">
      <LazyDeviationChart
        title="Blocks produced, against expected"
        subtitle={
          outliers > 0
            ? `${outliers} of ${items.length} operators are measurably off the mark. The rest are indistinguishable from each other.`
            : 'Every operator is within the margin of error — on this range, no one is measurably ahead or behind.'
        }
        coverage={coverage}
        items={items}
        baseline={1}
        format={signed}
        tickFormat={signed}
        yLabel="Difference from expected"
        bandLabel="Explained by chance"
        valueLabel="vs expected"
        height={height}
        loading={loading}
        error={error}
        empty={
          items.length === 0 ? 'No operator was in the active set for enough of this range.' : null
        }
      />
    </LazyChart>
  );
}
