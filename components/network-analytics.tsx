'use client';

import { useMemo } from 'react';
import { useEraSeries, useLatest, useManifest } from '@/lib/data/queries';
import { useResolvedRange, EraRangeControl } from '@/components/era-range-control';
import dynamic from 'next/dynamic';
import { LazyChart, LazyEraSeriesChart } from '@/components/charts/lazy-chart';
import { StatTile } from '@/components/stat-tile';
import { EraStatus } from '@/components/era-status';
import { RewardCurve, RewardCurveReading } from '@/components/reward-curve';
import { HeadingWithTip } from '@/components/info-tip';
import { AsOf, ErrorState } from '@/components/states';
import { Sparkline } from '@/components/charts/sparkline';
import { REWARD_CURVE } from '@/lib/metrics/staking';
import {
  formatBaseUnits,
  formatNumber,
  formatPercent,
  formatPolyx,
  formatRelativeTime,
} from '@/lib/format';

/**
 * The decentralisation section sits well below the fold and carries its own
 * Lorenz chart and concentration maths, so it is code-split rather than loaded
 * with the page. Together with the lazy charts this is what holds the critical
 * path under budget — measured, not assumed.
 */
const Decentralisation = dynamic(
  () => import('@/components/decentralisation').then((m) => m.Decentralisation),
  { ssr: false, loading: () => null },
);

/**
 * Network analytics.
 *
 * Organised by the question each section answers rather than by data shape —
 * the previous app's pages were "Overview / History / Trends / Current Info",
 * which describe the *form* of the data and tell a reader nothing about what
 * they will find.
 *
 * Every chart is lazily mounted (see `LazyChart`), which is what keeps the
 * chart kit off the critical path.
 */
export function NetworkAnalytics() {
  const manifest = useManifest();
  const latest = useLatest();
  const range = useResolvedRange(manifest.data);
  const { series, isLoading, isError, error, isFetching } = useEraSeries(range);

  const chartError = isError ? ((error as Error | null) ?? new Error('Unknown error')) : null;

  const percent = (value: number | null) => formatPercent(value, { decimals: 2 });
  const percentTick = (value: number) => formatPercent(value, { decimals: 0 });
  const polyx = (value: number | null) =>
    value == null ? '—' : formatPolyx(value, { compact: true });
  const count = (value: number | null) => formatNumber(value);

  /**
   * Change over the visible window, for the stat tiles.
   *
   * A bare number tells a reader nothing about direction — "APR 12.4%" is up or
   * down from what? Comparing the first and last values of the range they are
   * already looking at keeps the delta consistent with the charts below.
   */
  const delta = useMemo(() => {
    const network = series?.network;
    if (!network || series.eras.length < 2) return null;

    const change = (column: readonly number[]) => {
      const first = column[0];
      const last = column.at(-1);
      if (first == null || last == null || first === 0) return null;
      return (last - first) / first;
    };

    return {
      apr: change(network.avgApr),
      staked: change(network.totalStaked),
      operators: change(network.activeOperators),
    };
  }, [series]);

  const tileDelta = (value: number | null | undefined) =>
    value == null
      ? undefined
      : {
          value: formatPercent(Math.abs(value), { decimals: 1 }),
          direction: (value > 0.0005 ? 'up' : value < -0.0005 ? 'down' : 'flat') as
            'up' | 'down' | 'flat',
          label: 'over range',
        };

  if (latest.isError && manifest.isError) {
    return (
      <ErrorState
        title="Could not load network data"
        message="Neither the snapshot nor the era history responded. This is usually temporary."
        onRetry={() => {
          void latest.refetch();
          void manifest.refetch();
        }}
      />
    );
  }

  const asOf = latest.data ? <AsOf label={formatRelativeTime(latest.data.generatedAt)} /> : null;
  const ratio = latest.data?.stakingRatio;
  const decimals = manifest.data?.chain.tokenDecimals ?? 6;

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          {range && manifest.data
            ? `Showing eras ${formatNumber(range.fromEra)}–${formatNumber(range.toEra)}`
            : 'Loading history…'}
          {isFetching ? ' · updating' : ''}
        </p>
        <EraRangeControl manifest={manifest.data} />
      </div>

      {/* ---- Where the chain is right now ---- */}
      <section aria-labelledby="era-status-heading" className="mt-6">
        <HeadingWithTip
          as="h2"
          id="era-status-heading"
          className="mb-4"
          title="Chain status"
          lead="Where the era and session cycle has got to."
        >
          Everything here except the election phase is derived in your browser from the snapshot’s
          anchors against your own clock, so it ticks continuously and costs no network traffic.
          That is why the era and session progress move smoothly rather than jumping every fifteen
          minutes when a new snapshot lands.
        </HeadingWithTip>
        <EraStatus />
      </section>

      {/* ---- Returns ---- */}
      <section aria-labelledby="returns-heading" className="mt-6">
        <h2
          id="returns-heading"
          className="mb-1 text-[22px] leading-7 font-semibold tracking-tight"
        >
          Rewards and returns
        </h2>
        <p className="mt-0 mb-4 max-w-[65ch]" style={{ color: 'var(--text-secondary)' }}>
          What the network paid, and what a nominator actually earned after commission.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Return, after commission"
            value={formatPercent(latest.data?.impliedApr, { decimals: 2 })}
            hint="annualised at the current staking ratio"
            delta={tileDelta(delta?.apr)}
            footer={asOf}
            loading={latest.isLoading}
          />
          <StatTile
            label="Annual inflation"
            value={formatPercent(latest.data?.inflation, { decimals: 2 })}
            hint="capped by the fixed yearly reward"
            footer={asOf}
            loading={latest.isLoading}
          />
          <StatTile
            label="Staking ratio"
            value={formatPercent(ratio, { decimals: 2 })}
            hint={
              ratio == null
                ? undefined
                : ratio < REWARD_CURVE.xIdeal
                  ? `below the ${formatPercent(REWARD_CURVE.xIdeal, { decimals: 0 })} target — returns run high`
                  : `above the ${formatPercent(REWARD_CURVE.xIdeal, { decimals: 0 })} target — returns run low`
            }
            footer={asOf}
            loading={latest.isLoading}
          />
          <StatTile
            label="Total staked"
            value={formatBaseUnits(latest.data?.totalStaked, decimals, {
              compact: true,
              symbol: true,
            })}
            delta={tileDelta(delta?.staked)}
            footer={asOf}
            loading={latest.isLoading}
          />
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <LazyChart height={320} label="Average return">
            <LazyEraSeriesChart
              title="Average return over time"
              subtitle="Stake-weighted, after commission — what the network actually paid."
              series={series}
              operators={[]}
              band={
                series
                  ? {
                      lo: series.network.aprP10,
                      mid: series.network.aprP50,
                      hi: series.network.aprP90,
                    }
                  : undefined
              }
              reference={
                series ? { values: series.network.avgApr, label: 'Network average' } : undefined
              }
              format={percent}
              tickFormat={percentTick}
              yLabel="APR"
              loading={isLoading}
              error={chartError}
            />
          </LazyChart>

          <LazyChart height={260} label="Rewards paid">
            <LazyEraSeriesChart
              title="Rewards paid each era"
              subtitle="Total validator payout, before commission is deducted."
              series={series}
              operators={
                series
                  ? [{ id: 'reward', label: 'Paid', values: series.network.validatorReward }]
                  : []
              }
              format={polyx}
              tickFormat={(v) => formatPolyx(v, { compact: true })}
              yLabel="POLYX"
              includeZero
              height={260}
              loading={isLoading}
              error={chartError}
            />
          </LazyChart>
        </div>
      </section>

          {/* C3. The mechanism behind every APR elsewhere on the site, and
              the correction to the "70% target" framing — on Polymesh the
              fixed reward cap binds long before the curve's ideal. */}
          <div className="mt-4">
            <RewardCurve />
            <RewardCurveReading />
          </div>

      {/* ---- Stake ---- */}
      <section aria-labelledby="stake-heading" className="mt-12">
        <h2 id="stake-heading" className="mb-1 text-[22px] leading-7 font-semibold tracking-tight">
          Stake
        </h2>
        <p className="mt-0 mb-4 max-w-[65ch]" style={{ color: 'var(--text-secondary)' }}>
          How much POLYX is committed, and how that compares with the ratio the reward curve
          targets.
        </p>

        <LazyChart height={280} label="Total staked">
          <LazyEraSeriesChart
            title="Total staked over time"
            subtitle="Is the network attracting or losing stake?"
            series={series}
            operators={
              series ? [{ id: 'staked', label: 'Staked', values: series.network.totalStaked }] : []
            }
            format={polyx}
            tickFormat={(v) => formatPolyx(v, { compact: true })}
            yLabel="POLYX"
            height={280}
            loading={isLoading}
            error={chartError}
          />
        </LazyChart>
      </section>

      {/* ---- Participation ---- */}
      <section aria-labelledby="participation-heading" className="mt-12">
        <h2
          id="participation-heading"
          className="mb-1 text-[22px] leading-7 font-semibold tracking-tight"
        >
          Participation
        </h2>
        <p className="mt-0 mb-4 max-w-[65ch]" style={{ color: 'var(--text-secondary)' }}>
          Who is producing blocks, and how many are taking part.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Active operators"
            value={count(latest.data?.validatorCount.active ?? null)}
            hint={
              latest.data
                ? `${formatNumber(latest.data.validatorCount.waiting)} waiting · ${formatNumber(latest.data.validatorCount.max)} slots`
                : undefined
            }
            delta={tileDelta(delta?.operators)}
            footer={asOf}
            loading={latest.isLoading}
          />
          {/* Deliberately not labelled "Nominators". This is the sum of each
              operator's nominator count, so one account backing three
              operators is counted three times. Calling it a nominator count
              would overstate participation, and the true distinct figure is
              not derivable from the per-operator columns we store. */}
          <StatTile
            label="Nominations"
            value={count(series?.network.nominatorCount.at(-1) ?? null)}
            hint="operator–nominator pairs; one account backing three operators counts three times"
            loading={isLoading}
          />
          <StatTile
            label="Average commission"
            value={formatPercent(series?.network.avgCommission.at(-1) ?? null, { decimals: 2 })}
            hint="weighted by reward points"
            loading={isLoading}
          />
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <LazyChart height={260} label="Reward points">
            <LazyEraSeriesChart
              title="Reward points each era"
              subtitle="A steady line means block production is healthy; dips mean nodes were offline."
              series={series}
              operators={
                series
                  ? [{ id: 'points', label: 'Points', values: series.network.totalPoints }]
                  : []
              }
              format={count}
              tickFormat={(v) => formatNumber(v, { compact: true })}
              yLabel="points"
              includeZero
              height={260}
              loading={isLoading}
              error={chartError}
            />
          </LazyChart>

          <LazyChart height={240} label="Validator set size">
            <LazyEraSeriesChart
              title="Operators in the active set"
              subtitle="Is the validator set growing, shrinking, or churning?"
              series={series}
              operators={
                series
                  ? [{ id: 'active', label: 'Active', values: series.network.activeOperators }]
                  : []
              }
              format={count}
              tickFormat={(v) => formatNumber(v)}
              yLabel="operators"
              includeZero
              height={240}
              loading={isLoading}
              error={chartError}
            />
          </LazyChart>
        </div>
      </section>

      <Decentralisation latest={latest.data} loading={latest.isLoading} />

      {/* A compact trend strip, so the page ends with the shape of everything
          rather than trailing off after the last full chart. */}
      <section aria-label="Trends at a glance" className="mt-12">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          {(
            [
              ['Average APR', series?.network.avgApr, 'var(--series-1)'],
              ['Total staked', series?.network.totalStaked, 'var(--series-2)'],
              ['Reward points', series?.network.totalPoints, 'var(--series-4)'],
              ['Active operators', series?.network.activeOperators, 'var(--series-5)'],
            ] as const
          ).map(([label, values, colour]) => (
            <div key={label} className="flex items-center gap-2">
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <Sparkline values={values ?? []} colour={colour} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
