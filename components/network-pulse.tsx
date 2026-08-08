'use client';

import Link from 'next/link';
import { useLatest, useManifest } from '@/lib/data/queries';
import { useEraClock } from '@/lib/data/use-era-clock';
import { REWARD_CURVE } from '@/lib/metrics/staking';
import {
  formatBaseUnits,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from '@/lib/format';
import { StatTile } from './stat-tile';
import { AsOf, ErrorState } from './states';

/**
 * The network at a glance.
 *
 * Reads only `latest.json`, so it paints before any era chunk arrives — the
 * previous app put two nested full-page spinners in front of everything, which
 * meant a blank screen for the whole RPC handshake.
 *
 * Every snapshot-derived value carries an "as of" stamp; the era countdown does
 * not, because it is derived in the browser and is genuinely current.
 */
export function NetworkPulse() {
  const manifest = useManifest();
  const latest = useLatest();
  const clock = useEraClock(latest.data?.eraStatus);

  if (latest.isError) {
    return (
      <div className="mt-8">
        <ErrorState
          title="Could not load network data"
          message={
            latest.error instanceof Error
              ? latest.error.message
              : 'The data feed did not respond. This is usually temporary.'
          }
          onRetry={() => void latest.refetch()}
        />
      </div>
    );
  }

  const loading = latest.isLoading;
  const data = latest.data;
  const decimals = manifest.data?.chain.tokenDecimals ?? 6;
  const asOf = data ? <AsOf label={formatRelativeTime(data.generatedAt)} /> : null;

  // Below the ideal ratio, rewards run above their long-run level; above it,
  // below. Saying which side we are on is the difference between a number and
  // an insight.
  const ratio = data?.stakingRatio;
  const ratioHint =
    ratio == null
      ? undefined
      : ratio < REWARD_CURVE.xIdeal
        ? `below the ${formatPercent(REWARD_CURVE.xIdeal, { decimals: 0 })} target — returns run high`
        : `above the ${formatPercent(REWARD_CURVE.xIdeal, { decimals: 0 })} target — returns run low`;

  return (
    <>
      <section className="mt-10" aria-labelledby="pulse-heading">
        <h2 id="pulse-heading" className="sr-only">
          Network at a glance
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            emphasis
            label="Average return, after commission"
            value={formatPercent(data?.impliedApr, { decimals: 2 })}
            hint="annualised, at the current staking ratio"
            footer={asOf}
            loading={loading}
          />
          <StatTile
            label="Staked"
            value={formatBaseUnits(data?.totalStaked, decimals, { compact: true, symbol: true })}
            hint={ratioHint}
            footer={asOf}
            loading={loading}
          />
          <StatTile
            label="Staking ratio"
            value={formatPercent(ratio, { decimals: 2 })}
            hint="of total supply"
            footer={asOf}
            loading={loading}
          />
          <StatTile
            label="Annual inflation"
            value={formatPercent(data?.inflation, { decimals: 2 })}
            hint="capped by the fixed yearly reward"
            footer={asOf}
            loading={loading}
          />
          <StatTile
            label="Operators"
            value={
              data ? `${formatNumber(data.validatorCount.active)} active` : formatNumber(undefined)
            }
            hint={
              data
                ? `${formatNumber(data.validatorCount.waiting)} waiting · ${formatNumber(data.validatorCount.max)} slots`
                : undefined
            }
            footer={asOf}
            loading={loading}
          />
          <StatTile
            label={`Era ${data ? formatNumber(data.activeEra) : ''}`.trim()}
            value={
              clock
                ? clock.overdue
                  ? 'ending now'
                  : formatDuration(clock.secondsRemaining)
                : formatDuration(undefined)
            }
            hint={clock ? `${formatPercent(clock.progress, { decimals: 0 })} elapsed` : undefined}
            // No "as of" here: this ticks in the browser, so it is genuinely live.
            footer={
              clock ? (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  counting down live
                </span>
              ) : null
            }
            loading={loading}
          />
        </div>
      </section>

      <section className="mt-10 grid gap-3 sm:grid-cols-3" aria-label="Where to next">
        <EntryCard
          href="/operators"
          title="Find an operator"
          body="Compare every operator on return, commission, reliability and stake."
        />
        <EntryCard
          href="/my-staking"
          title="Check your staking"
          body="See what you have staked, what it has earned, and whether your picks are performing."
        />
        <EntryCard
          href="/calculator"
          title="Estimate returns"
          body="Project rewards for an amount and an operator, based on their actual history."
        />
      </section>
    </>
  );
}

function EntryCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1 rounded-[var(--radius-md)] border p-4 no-underline transition-colors"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <span className="font-semibold">
        {title}
        <span
          aria-hidden="true"
          className="ms-1 inline-block transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </span>
    </Link>
  );
}
