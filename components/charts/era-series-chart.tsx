'use client';

import { useMemo } from 'react';
import { ChartFrame } from './chart-frame';
import { MAX_NAMED_SERIES } from '@/lib/charts/palette';
import { BandedLineChart, type NamedSeries } from './banded-line-chart';
import { Legend, type LegendItem } from './legend';
import { SeriesTable, type SeriesTableColumn } from './series-table';
import { EmptyState } from '@/components/states';
import { formatEraDate } from '@/lib/format';
import type { StitchedSeries } from '@/lib/data/series';

/**
 * A complete era-series chart: frame, band, selected operators, legend, table.
 *
 * This is the composition Phases 4–6 reuse, rather than each page assembling
 * the pieces itself. It exists so that the rules in the design doc — a stated
 * question, a legend, a table view, stated coverage, a capped series count —
 * are enforced once rather than remembered five times.
 */

/** Stable empty array, so absent data does not churn referential equality. */
const NO_VALUES: readonly number[] = [];

export interface EraSeriesChartProps {
  title: string;
  subtitle?: string | undefined;
  series: StitchedSeries | null;
  /** Per-operator values, already derived. Order sets palette slots. */
  operators: readonly NamedSeries[];
  /** p10/p50/p90 across all operators, for the context band. */
  band?:
    | {
        lo: readonly (number | null)[];
        mid: readonly (number | null)[];
        hi: readonly (number | null)[];
      }
    | undefined;
  reference?: { values: readonly (number | null)[]; label: string } | undefined;
  format: (value: number | null) => string;
  /** Terser formatter for axis ticks; falls back to `format`. */
  tickFormat?: ((value: number) => string) | undefined;
  yLabel?: string | undefined;
  height?: number;
  includeZero?: boolean;
  /**
   * Appended to the coverage line.
   *
   * For anything the reader needs in order to read the plot correctly rather
   * than to know what it covers — chiefly `axisRangeNote`, which says a
   * non-zero-based axis is scaled to the data. Null is accepted so a caller can
   * pass the helper's result straight through.
   */
  note?: string | null | undefined;
  loading?: boolean | undefined;
  error?: Error | null | undefined;
  onRetry?: (() => void) | undefined;
  actions?: React.ReactNode;
  /** Called when a legend entry's remove button is used. */
  onRemoveOperator?: ((id: string) => void) | undefined;
}

export function EraSeriesChart({
  title,
  subtitle,
  series,
  operators,
  band,
  reference,
  format,
  tickFormat,
  yLabel,
  height = 320,
  includeZero = false,
  note,
  loading,
  error,
  onRetry,
  actions,
  onRemoveOperator,
}: EraSeriesChartProps) {
  // A module-level constant, not a fresh `[]` per render: an inline fallback
  // is a new reference every time, which would invalidate the memos below on
  // every render and defeat them entirely.
  const eras = series?.eras ?? NO_VALUES;
  const eraStart = series?.eraStart ?? NO_VALUES;

  /**
   * Coverage is stated, never implied. A chart that silently shows 40 eras when
   * 90 were asked for is worse than one that says so.
   */
  const coverage = useMemo(() => {
    if (eras.length === 0) return note ?? undefined;
    const from = formatEraDate(eraStart[0], { withYear: true });
    const to = formatEraDate(eraStart.at(-1), { withYear: true });
    const span = `${eras.length} eras · ${from} – ${to}`;
    return note ? `${span}. ${note}` : span;
  }, [eras.length, eraStart, note]);

  const legendItems = useMemo<LegendItem[]>(() => {
    const items: LegendItem[] = operators.slice(0, MAX_NAMED_SERIES).map((op) => ({
      id: op.id,
      label: op.label,
      variant: 'solid' as const,
      onRemove: onRemoveOperator ? () => onRemoveOperator(op.id) : undefined,
    }));

    // Context layers are listed last and visually distinguished, so they read
    // as background rather than as two more operators.
    if (band) {
      items.push({
        id: '__band',
        label: 'All operators (10th–90th percentile)',
        variant: 'band',
        colour: 'var(--band-fill)',
      });
      items.push({
        id: '__median',
        label: 'Median',
        variant: 'dashed',
        colour: 'var(--series-other)',
      });
    }
    if (reference) {
      items.push({
        id: '__reference',
        label: reference.label,
        variant: 'dashed',
        colour: 'var(--text-secondary)',
      });
    }
    return items;
  }, [operators, band, reference, onRemoveOperator]);

  const tableColumns = useMemo<SeriesTableColumn[]>(() => {
    const columns: SeriesTableColumn[] = operators.map((op) => ({
      key: op.id,
      label: op.label,
      values: op.values,
      format,
    }));
    if (reference) {
      columns.push({
        key: '__reference',
        label: reference.label,
        values: reference.values,
        format,
      });
    }
    if (band) {
      columns.push({ key: '__p10', label: 'p10', values: band.lo, format });
      columns.push({ key: '__p50', label: 'Median', values: band.mid, format });
      columns.push({ key: '__p90', label: 'p90', values: band.hi, format });
    }
    return columns;
  }, [operators, reference, band, format]);

  const isEmpty = !loading && !error && eras.length === 0;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      coverage={coverage}
      actions={actions}
      height={height}
      loading={loading}
      error={error}
      onRetry={onRetry}
      legend={<Legend items={legendItems} />}
      empty={
        isEmpty ? (
          <EmptyState
            title="No data for this range"
            message="History accumulates daily. Try a shorter range, or check back once more eras have been recorded."
          />
        ) : undefined
      }
      table={<SeriesTable caption={title} eras={eras} eraStart={eraStart} columns={tableColumns} />}
    >
      <>
        <BandedLineChart
          eras={eras}
          eraStart={eraStart}
          series={operators}
          band={band ? { ...band, label: '10th–90th percentile of all operators' } : undefined}
          reference={reference}
          format={format}
          tickFormat={tickFormat}
          yLabel={yLabel}
          height={height}
          includeZero={includeZero}
        />
        {/* A second, visually-hidden copy of the table, so a screen reader
            reaches the data without having to find and operate the tab. */}
        <SeriesTable
          hidden
          caption={`${title} — data table`}
          eras={eras}
          eraStart={eraStart}
          columns={tableColumns}
          maxRows={120}
        />
      </>
    </ChartFrame>
  );
}
