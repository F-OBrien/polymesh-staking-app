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
import { HeadingWithTip } from '@/components/info-tip';
import { LiveToggle } from '@/components/live-toggle';
import { useLive } from '@/lib/data/use-live';
import { useEraClock } from '@/lib/data/use-era-clock';
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

  /**
   * Live is opt-in and never gates first paint (§6.6a). When it is on, the
   * two current-era columns stop being a 15-minute-old snapshot and start
   * updating as blocks arrive — which is the "is my node producing right now?"
   * confirmation the previous app's live points chart provided.
   */
  const live = useLive();

  // Tier 3: derived in the browser from the snapshot's anchors against the
  // local clock, so it ticks with no network traffic at all (§6.6a).
  const clock = useEraClock(latest.data?.eraStatus);

  const rows = useMemo(
    () =>
      buildOperatorRows({
        series,
        latest: latest.data,
        registry: registry.data,
        erasPerYear,
        livePoints: live.enabled ? live.state.eraPoints : null,
      }),
    [series, latest.data, registry.data, erasPerYear, live.enabled, live.state.eraPoints],
  );

  /**
   * What the charts draw when nothing is pinned.
   *
   * Was "the five largest by stake", which was both vague and close to
   * meaningless: Polymesh's election equalises exposure, so the whole field
   * spans under 4% on total stake and the top five sit within 0.1% of each
   * other. Picking them was effectively picking at random and calling it a
   * ranking. Highest measured return over the selected range at least answers
   * the question the page is for. Phase 7's wallet nominations take precedence
   * over both when a wallet is connected.
   */
  const charted = useMemo(() => {
    if (selected.length > 0) return selected;
    if (!series) return [];
    return rankOperators(series, 'aprNet', 5, { erasPerYear });
  }, [selected, series, erasPerYear]);

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
        {/* The count only. Unpinning lives in the table's control row, next to
            the ★ column it undoes, rather than in a sentence above it. */}
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          {selected.length > 0
            ? `${selected.length} operator${selected.length === 1 ? '' : 's'} pinned`
            : 'Pin operators with ★ to compare them in the charts below'}
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
            rangeEras={series?.eras.length ?? null}
            eraProgress={clock?.progress ?? null}
            liveControl={<LiveToggle live={live} />}
            onClearPins={clear}
          />
        )}
      </section>

      <section aria-labelledby="comparison-heading" className="mt-12">
        <HeadingWithTip
          as="h2"
          id="comparison-heading"
          className="mb-4"
          title={
            selected.length > 0
              ? 'Pinned operators'
              : 'The five highest-returning operators'
          }
          lead={
            selected.length > 0
              ? undefined
              : 'Pin operators with ★ in the table above to compare them here instead.'
          }
        >
          {selected.length > 0 ? (
            <>
              Shown against the whole field, so a line can be judged in context rather than in
              isolation. Colours follow the operator, so they stay the same on every page and a
              filter change never repaints them.
            </>
          ) : (
            <>
              Ranked by mean return after commission over the era range selected above. Note that
              ranking operators by <em>stake</em> would not tell you much on Polymesh: the election
              spreads stake almost evenly, so the whole active set sits within a few percent of
              each other.
            </>
          )}
        </HeadingWithTip>

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
