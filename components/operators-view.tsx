'use client';

import { useMemo } from 'react';
import { useEraSeries, useLatest, useManifest, useOperators } from '@/lib/data/queries';
import { useSelectedOperators } from '@/lib/data/use-selection';
import { useResolvedRange, EraRangeControl } from '@/components/era-range-control';
import { buildOperatorRows } from '@/lib/data/operator-rows';
import { deriveOperatorApr } from '@/lib/metrics/derive';
import { rankOperators } from '@/lib/data/series';
import { OperatorsTable } from '@/components/operators-table';
import { LazyChart, LazyEraSeriesChart } from '@/components/charts/lazy-chart';
import { ErrorState, Skeleton } from '@/components/states';
import { formatPercent, formatPolyx } from '@/lib/format';
import type { NamedSeries } from '@/components/charts/banded-line-chart';

/**
 * The operator directory.
 *
 * Table first, charts second. That ordering is the point: a ranked, filterable
 * table is how the "who should I nominate?" question actually gets answered,
 * and the previous app had none — a hundred overlapping lines was the only
 * comparison tool it offered.
 *
 * The charts below react to whatever is pinned in the table, so the two are one
 * tool rather than two views of the same data.
 */
export function OperatorsView() {
  const manifest = useManifest();
  const latest = useLatest();
  const registry = useOperators();
  const range = useResolvedRange(manifest.data);
  const { series, isLoading, isError, error } = useEraSeries(range);
  const { selected, selectedSet, toggle, clear, isFull, max } = useSelectedOperators();

  const erasPerYear = manifest.data?.erasPerYear ?? 365;

  const rows = useMemo(
    () => buildOperatorRows({ series, latest: latest.data, registry: registry.data, erasPerYear }),
    [series, latest.data, registry.data, erasPerYear],
  );

  /**
   * What the charts draw.
   *
   * Falls back to the five largest by stake when nothing is pinned, so the
   * charts are never empty on arrival. Phase 7 will prefer the connected
   * wallet's nominations over both.
   */
  const charted = useMemo(() => {
    if (selected.length > 0) return selected;
    return series ? rankOperators(series, 'totalStake', 5) : [];
  }, [selected, series]);

  const nameOf = (address: string) => registry.data?.[address]?.nodeLabel ?? address;

  const aprSeries = useMemo<NamedSeries[]>(() => {
    if (!series) return [];
    return charted.flatMap((address) => {
      const columns = series.operators[address];
      if (!columns) return [];
      const { net } = deriveOperatorApr(columns, series.network, erasPerYear);
      return [{ id: address, label: nameOf(address), values: net }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf reads registry.data, listed below
  }, [series, charted, registry.data, erasPerYear]);

  const stakeSeries = useMemo<NamedSeries[]>(() => {
    if (!series) return [];
    return charted.flatMap((address) => {
      const columns = series.operators[address];
      if (!columns) return [];
      return [{ id: address, label: nameOf(address), values: columns.totalStake }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  }, [series, charted, registry.data]);

  const band = series
    ? { lo: series.network.aprP10, mid: series.network.aprP50, hi: series.network.aprP90 }
    : undefined;

  const chartError = isError ? ((error as Error | null) ?? new Error('Unknown error')) : null;
  const percent = (v: number | null) => formatPercent(v, { decimals: 2 });
  const polyx = (v: number | null) => (v == null ? '—' : formatPolyx(v, { compact: true }));

  if (latest.isError && manifest.isError) {
    return (
      <ErrorState
        title="Could not load operators"
        message="Neither the snapshot nor the era history responded. This is usually temporary."
        onRetry={() => {
          void latest.refetch();
          void manifest.refetch();
        }}
      />
    );
  }

  const tableLoading = isLoading || latest.isLoading || registry.isLoading;

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          {selected.length > 0 ? (
            <>
              {selected.length} pinned ·{' '}
              <button type="button" onClick={clear} className="underline">
                clear
              </button>
            </>
          ) : (
            'Pin operators with ★ to compare them in the charts below'
          )}
        </p>
        <EraRangeControl manifest={manifest.data} />
      </div>

      <section aria-labelledby="directory-heading" className="mt-6">
        <h2 id="directory-heading" className="sr-only">
          Operator directory
        </h2>

        {tableLoading && rows.length === 0 ? (
          <Skeleton height={480} label="Loading operators" />
        ) : (
          <OperatorsTable
            rows={rows}
            selectedSet={selectedSet}
            onTogglePin={toggle}
            selectionFull={isFull}
            maxSelected={max}
            loading={tableLoading}
          />
        )}
      </section>

      <section aria-labelledby="comparison-heading" className="mt-12">
        <h2
          id="comparison-heading"
          className="mb-1 text-[22px] leading-7 font-semibold tracking-tight"
        >
          {selected.length > 0 ? 'Pinned operators' : 'The five largest operators'}
        </h2>
        <p className="mt-0 mb-4 max-w-[65ch]" style={{ color: 'var(--text-secondary)' }}>
          {selected.length > 0
            ? 'Shown against the whole field, so a line can be judged in context rather than in isolation.'
            : 'Pin operators in the table above to compare them here. Colours follow the operator, so they stay the same on every page.'}
        </p>

        <div className="flex flex-col gap-4">
          <LazyChart height={320} label="Operator return">
            <LazyEraSeriesChart
              title="Return, after commission"
              subtitle="How do these operators compare with the field?"
              series={series}
              operators={aprSeries}
              band={band}
              reference={
                series ? { values: series.network.avgApr, label: 'Network average' } : undefined
              }
              format={percent}
              tickFormat={(v) => formatPercent(v, { decimals: 0 })}
              yLabel="APR"
              loading={isLoading}
              error={chartError}
              onRemoveOperator={selected.length > 0 ? toggle : undefined}
            />
          </LazyChart>

          <LazyChart height={280} label="Operator stake">
            <LazyEraSeriesChart
              title="Stake backing each operator"
              subtitle="Is stake flowing toward or away from them?"
              series={series}
              operators={stakeSeries}
              format={polyx}
              tickFormat={(v) => formatPolyx(v, { compact: true })}
              yLabel="POLYX"
              height={280}
              loading={isLoading}
              error={chartError}
              onRemoveOperator={selected.length > 0 ? toggle : undefined}
            />
          </LazyChart>
        </div>
      </section>
    </>
  );
}
