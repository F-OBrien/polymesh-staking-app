'use client';

import { useMemo, useState } from 'react';
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
  /**
   * What one point on the x axis is, when it is not an era.
   *
   * The weekly rollup feeds this chart 250 buckets spanning 1,749 eras, and the
   * coverage line read "250 eras" — understating the history fivefold while
   * looking authoritative. The caller knows the resolution; the chart cannot.
   */
  pointNoun?: string | undefined;
  /**
   * An axis ceiling and the sentence that has to accompany it.
   *
   * Taken as one value rather than a `yMax` and a `note`, because the two are
   * only ever true together: on a log axis nothing is clipped, so a note
   * claiming "33 points run off the top" would be describing a chart the
   * reader is not looking at. Passing them separately made that mismatch
   * possible; passing them joined does not. See `outlierCap`.
   */
  cap?: { max: number; note: string } | null | undefined;
  /**
   * Offers a linear/log switch above the plot, starting on `linear`.
   *
   * Only for charts whose data actually spans orders of magnitude — a return
   * series carrying a validator's first era, or the chain's own first weeks.
   * On a series that does not, the two views are identical and the control is
   * just another thing to read.
   */
  offerLogScale?: boolean | undefined;
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
  pointNoun = 'eras',
  cap,
  offerLogScale = false,
  loading,
  error,
  onRetry,
  actions,
  onRemoveOperator,
}: EraSeriesChartProps) {
  const [scaleType, setScaleType] = useState<'linear' | 'log'>('linear');

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
    const span = `${eras.length} ${pointNoun} · ${from} – ${to}`;
    // A log axis has to be declared. Equal vertical distances are equal
    // *ratios*, so a reader who assumes linear will misread every gap on it.
    // Joined with a separator, trailing full stops stripped, so the line reads
    // as a list of facts rather than a paragraph. It sits beside the frame's
    // controls, and every extra line it wraps to pushes the plot further down.
    return [span, note, cap?.note, scaleType === 'log' ? 'Log scale' : null]
      .filter(Boolean)
      .map((part) => String(part).trim().replace(/\.$/, ''))
      .join(' · ');
  }, [eras.length, eraStart, note, pointNoun, scaleType, cap]);

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

    // Only when something is actually missing. A tinted column in an operator's
    // own colour needs saying once; listing it on every chart, including the
    // ones with no gaps, would be chrome explaining nothing.
    if (operators.some((op) => op.values.some((v) => v == null || !Number.isFinite(v)))) {
      items.push({
        id: '__gaps',
        label: 'Shaded: that operator was not in the set, so earned nothing',
        variant: 'band',
        colour: 'var(--series-other-alpha)',
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

  const scaleControl = offerLogScale ? (
    <div
      role="group"
      aria-label="Value axis scale"
      className="flex items-center gap-0.5 rounded-full border p-0.5 text-xs"
      style={{ borderColor: 'var(--border)' }}
    >
      {(['linear', 'log'] as const).map((option) => {
        const on = option === scaleType;
        return (
          <button
            key={option}
            type="button"
            onClick={() => setScaleType(option)}
            aria-pressed={on}
            className="rounded-full px-2 py-0.5 capitalize transition-colors"
            style={{
              color: on ? 'var(--text-primary)' : 'var(--text-muted)',
              background: on ? 'var(--surface-2)' : 'transparent',
              fontWeight: on ? 600 : 400,
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      coverage={coverage}
      actions={
        scaleControl ? (
          <div className="flex items-center gap-2">
            {actions}
            {scaleControl}
          </div>
        ) : (
          actions
        )
      }
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
          yMax={cap?.max}
          scaleType={scaleType}
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
