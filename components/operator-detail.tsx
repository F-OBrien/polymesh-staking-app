'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useEraSeries, useLatest, useManifest, useOperators } from '@/lib/data/queries';
import { useSelectedOperators } from '@/lib/data/use-selection';
import { useResolvedRange, EraRangeControl } from '@/components/era-range-control';
import { buildOperatorRows } from '@/lib/data/operator-rows';
import { deriveOperatorApr, derivePointsShare, deriveSelfStakeRatio } from '@/lib/metrics/derive';
import { LazyChart, LazyEraSeriesChart } from '@/components/charts/lazy-chart';
import { StatTile } from '@/components/stat-tile';
import { AsOf, EmptyState, ErrorState } from '@/components/states';
import { explorerAccountUrl } from '@/config/networks';
import {
  formatNumber,
  formatPercent,
  formatPolyx,
  formatRelativeTime,
  truncateAddress,
} from '@/lib/format';
import type { NamedSeries } from '@/components/charts/banded-line-chart';

/**
 * One operator, in depth.
 *
 * Entirely new: the previous app had a hundred operators and not a single page
 * for any of them. Every series is drawn against the field's distribution band,
 * because "12% return" means nothing without knowing what the others managed
 * that week.
 */
export function OperatorDetail({ address }: { address: string }) {
  const manifest = useManifest();
  const latest = useLatest();
  const registry = useOperators();
  const range = useResolvedRange(manifest.data);
  const { series, isLoading, isError, error } = useEraSeries(range);
  const { selectedSet, toggle, isFull } = useSelectedOperators();

  const erasPerYear = manifest.data?.erasPerYear ?? 365;
  const record = registry.data?.[address];
  const columns = series?.operators[address];

  const row = useMemo(() => {
    const rows = buildOperatorRows({
      series,
      latest: latest.data,
      registry: registry.data,
      erasPerYear,
    });
    return rows.find((r) => r.address === address) ?? null;
  }, [series, latest.data, registry.data, erasPerYear, address]);

  const derived = useMemo(() => {
    if (!series || !columns) return null;
    return {
      apr: deriveOperatorApr(columns, series.network, erasPerYear),
      pointsShare: derivePointsShare(columns, series.network),
      selfStake: deriveSelfStakeRatio(columns),
    };
  }, [series, columns, erasPerYear]);

  const label = record?.nodeLabel ?? truncateAddress(address);
  const pinned = selectedSet.has(address);
  const band = series
    ? { lo: series.network.aprP10, mid: series.network.aprP50, hi: series.network.aprP90 }
    : undefined;
  const chartError = isError ? ((error as Error | null) ?? new Error('Unknown error')) : null;

  const percent = (v: number | null) => formatPercent(v, { decimals: 2 });
  const polyx = (v: number | null) => (v == null ? '—' : formatPolyx(v, { compact: true }));

  const asOf = latest.data ? <AsOf label={formatRelativeTime(latest.data.generatedAt)} /> : null;

  if (isError && latest.isError) {
    return (
      <ErrorState
        title="Could not load this operator"
        message="The data feed did not respond. This is usually temporary."
        onRetry={() => void latest.refetch()}
      />
    );
  }

  // An address that exists in neither the registry nor the range is either a
  // typo or an operator from before our history begins. Saying which is more
  // useful than an empty page.
  const unknown = !isLoading && !latest.isLoading && !registry.isLoading && row == null;

  return (
    <>
      <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-3xl leading-9 font-semibold tracking-tight">{label}</h1>
          <p className="mt-2 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {truncateAddress(address, 8, 8)}
            </code>
            <a
              href={explorerAccountUrl(address)}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'var(--text-secondary)' }}
            >
              View on Subscan ↗
            </a>
            {record?.website ? (
              <a
                href={record.website}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: 'var(--text-secondary)' }}
              >
                Website ↗
              </a>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggle(address)}
            disabled={isFull && !pinned}
            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: pinned ? 'var(--series-1)' : 'var(--border)',
              color: pinned ? 'var(--series-1)' : 'var(--text-primary)',
            }}
          >
            <span aria-hidden="true">{pinned ? '★' : '☆'}</span>{' '}
            {pinned ? 'Pinned' : 'Pin to charts'}
          </button>
          <Link
            href="/operators/"
            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm no-underline"
            style={{ borderColor: 'var(--border)' }}
          >
            All operators
          </Link>
        </div>
      </header>

      {unknown ? (
        <div className="mt-8">
          <EmptyState
            title="No data for this operator"
            message="This address is not in the current validator set, and has no history in the range we hold. It may predate our records, or the address may be mistyped."
            action={
              <Link href="/operators/" className="mt-1 text-sm">
                Browse all operators
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
              {row?.status === 'active'
                ? 'Elected in the current era'
                : row?.status === 'waiting'
                  ? 'Declared, but not elected this era'
                  : 'Not currently in the active set'}
            </p>
            <EraRangeControl manifest={manifest.data} />
          </div>

          <section aria-label="Key figures" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* Three periods, not one. "Return" meaning a mean over
                  whatever range was selected — and saying so only in a hint —
                  conflated what this operator is earning now with what it has
                  averaged. All three are after commission. */}
              <StatTile
                emphasis
                label="Return, this era"
                value={percent(row?.aprThisEra ?? null)}
                hint="estimated from points so far, after commission"
                footer={asOf}
                loading={latest.isLoading}
              />
              <StatTile
                label="Return, last era"
                value={percent(row?.aprLastEra ?? null)}
                hint={
                  row?.lastEraIndex == null
                    ? 'actual, most recent complete era'
                    : `actual, era ${row.lastEraIndex}`
                }
                loading={isLoading}
              />
              <StatTile
                label="Return, mean"
                value={percent(row?.aprMean ?? null)}
                hint="after commission, across the selected range"
                loading={isLoading}
              />
              <StatTile
                label="Steadiness"
                value={row?.aprStdDev == null ? '—' : `±${percent(row.aprStdDev)}`}
                hint="lower means a less variable return"
                loading={isLoading}
              />
              <StatTile
                label="Commission"
                value={percent(row?.commission ?? null)}
                footer={asOf}
                loading={latest.isLoading}
              />
              <StatTile
                label="Stake"
                value={polyx(row?.totalStake ?? null)}
                hint={
                  row?.selfStakeRatio == null
                    ? undefined
                    : `${formatPercent(row.selfStakeRatio, { decimals: 1 })} self-staked`
                }
                footer={asOf}
                loading={latest.isLoading}
              />
              <StatTile
                label="Nominators"
                value={formatNumber(row?.nominatorCount ?? null)}
                footer={asOf}
                loading={latest.isLoading}
              />
              <StatTile
                label="Share of reward points"
                value={percent(row?.pointsShare ?? null)}
                hint="in the most recent era with data"
                loading={isLoading}
              />
              <StatTile
                label="First seen"
                value={record ? `Era ${formatNumber(record.firstSeenEra)}` : '—'}
                hint={record ? `last seen era ${formatNumber(record.lastSeenEra)}` : undefined}
                loading={registry.isLoading}
              />
              <StatTile
                label="Identity"
                value={record?.name ?? 'Unregistered'}
                hint={
                  record?.did ? truncateAddress(record.did, 8, 6) : 'no on-chain identity found'
                }
                loading={registry.isLoading}
              />
            </div>
          </section>

          <section aria-labelledby="detail-charts" className="mt-10">
            <h2
              id="detail-charts"
              className="mb-4 text-[22px] leading-7 font-semibold tracking-tight"
            >
              Against the field
            </h2>

            <div className="flex flex-col gap-4">
              <LazyChart height={320} label="Return">
                <LazyEraSeriesChart
                  title="Return, after commission"
                  subtitle="The shaded band is the 10th–90th percentile of all operators, so this line can be read in context."
                  series={series}
                  operators={
                    derived ? [{ id: address, label, values: derived.apr.net } as NamedSeries] : []
                  }
                  band={band}
                  reference={
                    series ? { values: series.network.avgApr, label: 'Network average' } : undefined
                  }
                  format={percent}
                  tickFormat={(v) => formatPercent(v, { decimals: 0 })}
                  yLabel="APR"
                  loading={isLoading}
                  error={chartError}
                />
              </LazyChart>

              <LazyChart height={260} label="Share of reward points">
                <LazyEraSeriesChart
                  title="Share of reward points"
                  subtitle="Raw points depend on how many operators were active; the share is comparable across eras."
                  series={series}
                  operators={
                    derived
                      ? [
                          {
                            id: `${address}-points`,
                            label,
                            values: derived.pointsShare,
                          } as NamedSeries,
                        ]
                      : []
                  }
                  format={(v) => formatPercent(v, { decimals: 3 })}
                  tickFormat={(v) => formatPercent(v, { decimals: 2 })}
                  yLabel="share"
                  includeZero
                  height={260}
                  loading={isLoading}
                  error={chartError}
                />
              </LazyChart>

              <LazyChart height={260} label="Stake and self-stake">
                <LazyEraSeriesChart
                  title="Stake backing this operator"
                  subtitle="Is stake flowing toward or away from it?"
                  series={series}
                  operators={
                    columns
                      ? [
                          {
                            id: `${address}-stake`,
                            label,
                            values: columns.totalStake,
                          } as NamedSeries,
                        ]
                      : []
                  }
                  format={polyx}
                  tickFormat={(v) => formatPolyx(v, { compact: true })}
                  yLabel="POLYX"
                  height={260}
                  loading={isLoading}
                  error={chartError}
                />
              </LazyChart>

              <LazyChart height={240} label="Commission">
                <LazyEraSeriesChart
                  title="Commission over time"
                  subtitle="A rise here reduces what nominators keep, and is worth noticing before it does."
                  series={series}
                  operators={
                    columns
                      ? [
                          {
                            id: `${address}-commission`,
                            label,
                            values: columns.commission,
                          } as NamedSeries,
                        ]
                      : []
                  }
                  format={(v) => formatPercent(v, { decimals: 2 })}
                  tickFormat={(v) => formatPercent(v, { decimals: 0 })}
                  yLabel="commission"
                  includeZero
                  height={240}
                  loading={isLoading}
                  error={chartError}
                />
              </LazyChart>
            </div>
          </section>
        </>
      )}
    </>
  );
}
