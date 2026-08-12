'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useEraSeries, useLatest, useManifest, useOperators } from '@/lib/data/queries';
import { useSelectedOperators } from '@/lib/data/use-selection';
import { EraRangeControl, useResolvedRange } from '@/components/era-range-control';
import { buildOperatorRows, type OperatorRow } from '@/lib/data/operator-rows';
import { buildComparison, notableDifferences, type MetricDefinition } from '@/lib/data/comparison';
import { deriveOperatorApr } from '@/lib/metrics/derive';
import { OperatorPicker } from '@/components/operator-picker';
import { LazyChart, LazyEraSeriesChart } from '@/components/charts/lazy-chart';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { SERIES_TOKENS } from '@/lib/charts/palette';
import { outlierCap } from '@/lib/charts/notes';
import { buildLabeller } from '@/lib/data/operator-label';
import { CopyAddress } from '@/components/copy-address';
import { formatNumber, formatPercent, formatPolyx, truncateAddress } from '@/lib/format';
import type { NamedSeries } from '@/components/charts/banded-line-chart';

/**
 * Side-by-side comparison of the pinned operators.
 *
 * The selection is the same `?ops=` set used everywhere else, so pinning on
 * `/operators` and navigating here carries the choice over — and the URL is
 * shareable, which is how this analysis actually travels. The previous app had
 * no comparison view at all; the closest thing was a hundred overlapping lines.
 *
 * The metric table is the substance. Charts follow, because a table answers
 * "which is better on X" and a chart answers "has that been true consistently",
 * and the first question is asked far more often.
 */

const percent2 = (v: number | null) => formatPercent(v, { decimals: 2 });
const polyx = (v: number | null) => (v == null ? '—' : formatPolyx(v, { compact: true }));

/**
 * What gets compared, and which direction is better.
 *
 * `notableSpread` is the threshold above which a difference is worth pointing
 * at. The values are judgements, and stated as such: a 1pp gap in return is
 * material over a year, a 0.2pp gap is noise; a 5pp commission difference
 * changes what you keep, a rounding difference does not.
 */
const METRICS: MetricDefinition[] = [
  // Three returns rather than one. They answer different questions and can
  // disagree sharply — an operator can be top of the field this era and
  // mid-table over ninety — so a comparison that shows only one of them is
  // making the choice for the reader. All three are after commission, which is
  // what a nominator actually receives; the gross figures are in the CSV.
  {
    key: 'aprThisEra',
    label: 'Return, this era',
    hint: 'estimated from points scored so far — noisy early in an era',
    polarity: 'higher',
    value: (r) => r.aprThisEra,
    format: percent2,
    notableSpread: 0.01,
  },
  {
    key: 'aprLastEra',
    label: 'Return, last era',
    hint: 'actual, for the most recent complete era',
    polarity: 'higher',
    value: (r) => r.aprLastEra,
    format: percent2,
    notableSpread: 0.01,
  },
  {
    key: 'aprMean',
    label: 'Return, mean',
    hint: 'after commission, averaged across the selected range',
    polarity: 'higher',
    value: (r) => r.aprMean,
    format: percent2,
    notableSpread: 0.01,
  },
  {
    key: 'aprStdDev',
    label: 'Steadiness',
    hint: 'lower means a less variable return',
    polarity: 'lower',
    value: (r) => r.aprStdDev,
    format: (v) => (v == null ? '—' : `±${percent2(v)}`),
    notableSpread: 0.01,
  },
  {
    key: 'commission',
    label: 'Commission',
    hint: 'the operator’s cut, before you are paid',
    polarity: 'lower',
    value: (r) => r.commission,
    format: percent2,
    notableSpread: 0.05,
  },
  {
    key: 'selfStakeRatio',
    label: 'Self-staked',
    hint: 'the operator’s own money at risk',
    polarity: 'higher',
    value: (r) => r.selfStakeRatio,
    format: (v) => formatPercent(v, { decimals: 1 }),
    notableSpread: 0.1,
  },
  {
    key: 'totalStake',
    // No polarity: a large operator is not better, and for decentralisation it
    // is worse. Marking a "winner" here would push nominations the wrong way.
    label: 'Total stake',
    hint: 'neither better nor worse — but concentration is',
    polarity: 'none',
    value: (r) => r.totalStake,
    format: polyx,
  },
  {
    key: 'nominatorCount',
    label: 'Nominators',
    polarity: 'none',
    value: (r) => r.nominatorCount,
    format: (v) => formatNumber(v),
  },
  {
    key: 'pointsShare',
    label: 'Share of reward points',
    hint: 'how much of the network’s work it did',
    polarity: 'higher',
    value: (r) => r.pointsShare,
    format: (v) => formatPercent(v, { decimals: 3 }),
    notableSpread: 0.002,
  },
];

export function CompareView() {
  const manifest = useManifest();
  const latest = useLatest();
  const registry = useOperators();
  const range = useResolvedRange(manifest.data);
  const { series, isLoading, isError, error } = useEraSeries(range);
  const { selected, selectedSet, toggle, clear, isFull, max } = useSelectedOperators();

  const erasPerYear = manifest.data?.erasPerYear ?? 365;

  const allRows = useMemo(
    () => buildOperatorRows({ series, latest: latest.data, registry: registry.data, erasPerYear }),
    [series, latest.data, registry.data, erasPerYear],
  );

  // Ordered by the URL, not by the directory's sort: the columns should stay
  // where the reader put them, and the palette slot follows the same order.
  const rows = useMemo(
    () => selected.flatMap((address) => allRows.filter((row) => row.address === address)),
    [selected, allRows],
  );

  const labelOf = useMemo(() => buildLabeller(registry.data), [registry.data]);
  const comparison = useMemo(() => buildComparison(rows, METRICS), [rows]);
  const notable = useMemo(() => notableDifferences(comparison), [comparison]);

  const aprSeries = useMemo<NamedSeries[]>(() => {
    if (!series) return [];
    return rows.flatMap((row) => {
      const columns = series.operators[row.address];
      if (!columns) return [];
      const { net } = deriveOperatorApr(columns, series.network, erasPerYear);
      return [{ id: row.address, label: labelOf(row.address), values: net }];
    });
  }, [series, rows, labelOf, erasPerYear]);

  const stakeSeries = useMemo<NamedSeries[]>(() => {
    if (!series) return [];
    return rows.flatMap((row) => {
      const columns = series.operators[row.address];
      if (!columns) return [];
      return [{ id: row.address, label: labelOf(row.address), values: columns.totalStake }];
    });
  }, [series, rows, labelOf]);

  const commissionSeries = useMemo<NamedSeries[]>(() => {
    if (!series) return [];
    return rows.flatMap((row) => {
      const columns = series.operators[row.address];
      if (!columns) return [];
      return [{ id: row.address, label: labelOf(row.address), values: columns.commission }];
    });
  }, [series, rows, labelOf]);

  const band = series
    ? { lo: series.network.aprP10, mid: series.network.aprP50, hi: series.network.aprP90 }
    : undefined;
  /** See the note in `operator-detail.tsx`. Taken across every series drawn. */
  const aprCap = useMemo(
    () =>
      outlierCap(
        [
          ...aprSeries.flatMap((s) => s.values),
          ...(series?.network.aprP90 ?? []),
          ...(series?.network.avgApr ?? []),
        ],
        (v) => formatPercent(v, { decimals: 0 }),
        { because: 'in a first era' },
      ),
    [aprSeries, series],
  );

  const chartError = isError ? ((error as Error | null) ?? new Error('Unknown error')) : null;

  if (manifest.isError && latest.isError) {
    return (
      <ErrorState
        title="Could not load the comparison"
        message="Neither the snapshot nor the era history responded. This is usually temporary."
        onRetry={() => {
          void manifest.refetch();
          void latest.refetch();
        }}
      />
    );
  }

  const loading = isLoading || latest.isLoading || registry.isLoading;

  return (
    <>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <OperatorPicker
            rows={allRows}
            selected={selectedSet}
            onSelect={toggle}
            disabled={isFull}
            disabledReason={`${max} is the maximum. Remove one to add another.`}
          />
          {/* A real button rather than the muted underline this was: with
              several operators pinned, removing them one at a time is the
              slowest thing on the page. */}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={clear}
              className="self-start rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
              title="Remove every pinned operator from this comparison"
            >
              <span aria-hidden="true">☆ </span>
              Unpin all ({selected.length})
            </button>
          ) : null}
        </div>
        <EraRangeControl manifest={manifest.data} />
      </div>

      {selected.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing to compare yet"
            message="Add operators above, or pin them with ★ in the directory. Your selection travels in the URL, so a comparison can be sent to someone."
            action={
              <Link href="/operators/" className="mt-1 text-sm">
                Browse the directory
              </Link>
            }
          />
        </div>
      ) : loading && rows.length === 0 ? (
        <Skeleton height={420} label="Loading comparison" />
      ) : rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No data for the selected operators"
            message="These addresses have no history in the current era range. Try widening the range, or check the addresses in the URL."
          />
        </div>
      ) : (
        <>
          {notable.length > 0 ? (
            <section
              aria-labelledby="notable"
              className="mt-8 rounded-[var(--radius-md)] border p-4"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            >
              <h2 id="notable" className="m-0 text-[17px] leading-6 font-semibold">
                Differences that matter
              </h2>
              <p className="mt-1 mb-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                On most measures these operators are alike. These are the ones where they are not.
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                {notable.map((row) => {
                  const best = row.cells.find((c) => c.best);
                  return (
                    <li key={row.key} className="flex flex-wrap items-baseline gap-x-2">
                      <strong>{row.label}</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        spans {row.cells.filter((c) => c.value != null).length} operators
                        {best ? `, best is ${nameFor(rows, best.address)} at ${best.display}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="mt-8 mb-0 text-sm" style={{ color: 'var(--text-muted)' }}>
              No measure separates these operators by enough to matter. On this evidence the choice
              between them is a coin toss — which is worth knowing.
            </p>
          )}

          <section aria-labelledby="metrics" className="mt-8">
            <h2 id="metrics" className="sr-only">
              Metric comparison
            </h2>
            <ComparisonTable rows={rows} comparison={comparison} onRemove={toggle} />
          </section>

          <section aria-labelledby="over-time" className="mt-12">
            <h2 id="over-time" className="mb-1 text-[22px] leading-7 font-semibold tracking-tight">
              Over time
            </h2>
            <p className="mt-0 mb-4 max-w-[65ch]" style={{ color: 'var(--text-secondary)' }}>
              A table says which is ahead today. These say whether it has been.
            </p>

            <div className="flex flex-col gap-4">
              <LazyChart height={320} label="Return over time">
                <LazyEraSeriesChart
                  title="Return, after commission"
                  subtitle="The shaded band is the 10th–90th percentile of all operators."
                  // Comparing operators with different join dates puts a first
                  // era — a multiple of anything after it — next to settled
                  // history. See the note in `operator-detail.tsx`.
                  offerLogScale
                  cap={aprCap}
                  series={series}
                  operators={aprSeries}
                  band={band}
                  reference={
                    series ? { values: series.network.avgApr, label: 'Network average' } : undefined
                  }
                  format={percent2}
                  tickFormat={(v) => formatPercent(v, { decimals: 0 })}
                  yLabel="APR"
                  loading={isLoading}
                  error={chartError}
                  onRemoveOperator={toggle}
                />
              </LazyChart>

              <LazyChart height={280} label="Commission over time">
                <LazyEraSeriesChart
                  title="Commission"
                  subtitle="A rise reduces what nominators keep, and is worth noticing before it does."
                  series={series}
                  operators={commissionSeries}
                  format={percent2}
                  tickFormat={(v) => formatPercent(v, { decimals: 0 })}
                  yLabel="commission"
                  includeZero
                  height={280}
                  loading={isLoading}
                  error={chartError}
                  onRemoveOperator={toggle}
                />
              </LazyChart>

              <LazyChart height={280} label="Stake over time">
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
                  onRemoveOperator={toggle}
                />
              </LazyChart>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function nameFor(rows: readonly OperatorRow[], address: string): string {
  return rows.find((row) => row.address === address)?.name ?? truncateAddress(address);
}

/**
 * Metrics down, operators across.
 *
 * That orientation rather than the directory's: comparing four operators on one
 * metric means reading along a row, and rows are easier to scan than columns.
 * It also keeps the operator names in a header row where they can carry their
 * palette colour, matching the charts below.
 *
 * The best value in each row is marked with a check *and* a weight change, not
 * colour — the palette swatch beside each name already uses colour for
 * identity, and reusing it for quality would collide.
 */
function ComparisonTable({
  rows,
  comparison,
  onRemove,
}: {
  rows: readonly OperatorRow[];
  comparison: ReturnType<typeof buildComparison>;
  onRemove: (address: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <caption className="pb-2 text-left" style={{ color: 'var(--text-muted)' }}>
          Best value in each row is marked ✓. Stake and nominator counts have no “best”.
        </caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th scope="col" className="p-2 text-left font-medium">
              Measure
            </th>
            {rows.map((row, i) => (
              <th key={row.address} scope="col" className="p-2 text-right font-medium">
                <span className="flex items-center justify-end gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: SERIES_TOKENS[i % SERIES_TOKENS.length] }}
                  />
                  <Link href={`/operators/${row.address}/`} className="truncate">
                    {row.name}
                  </Link>
                  <CopyAddress
                    address={row.address}
                    label={row.name}
                    className="shrink-0 text-xs font-normal"
                  />
                  <button
                    type="button"
                    onClick={() => onRemove(row.address)}
                    aria-label={`Remove ${row.name} from the comparison`}
                    className="shrink-0 px-0.5 leading-none"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.map((metric) => (
            <tr key={metric.key} style={{ borderTop: '1px solid var(--border)' }}>
              <th scope="row" className="p-2 text-left font-normal">
                {metric.label}
                {metric.hint ? (
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    {metric.hint}
                  </span>
                ) : null}
              </th>
              {metric.cells.map((cell) => (
                <td
                  key={cell.address}
                  className={`p-2 text-right ${cell.best ? 'font-semibold' : ''}`}
                >
                  {cell.display}
                  {cell.best ? (
                    <>
                      {' '}
                      <span aria-hidden="true">✓</span>
                      <span className="sr-only">best</span>
                    </>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
