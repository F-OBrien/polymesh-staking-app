'use client';

import { useEraClock } from '@/lib/data/use-era-clock';
import { useLatest } from '@/lib/data/queries';
import { InfoTip } from '@/components/info-tip';
import { AsOf, Skeleton } from '@/components/states';
import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import type { ElectionPhase } from '@/lib/chain/compat';

/**
 * Where the chain is in its era and session cycle.
 *
 * All of this was derivable and none of it was shown: the era index appeared
 * only as a countdown tile, and the session, the era's start and end, and the
 * election phase appeared nowhere at all. The Polymesh Portal surfaces them
 * because they are what you check when something looks wrong — whether a
 * payout is due, whether the set is about to change, whether a node has time to
 * recover before the next election.
 *
 * **Tier 3 throughout (design doc §6.6a).** Everything here except the election
 * phase is computed in the browser from `latest.json`'s anchors against the
 * local clock, so it ticks smoothly and costs no network traffic. The snapshot
 * carries a `currentSessionIndex`, and this deliberately does *not* use it —
 * a fixed index would sit on the wrong session for most of the fifteen minutes
 * until the next snapshot.
 */

const PHASE_COPY: Record<ElectionPhase, { label: string; detail: string }> = {
  Off: {
    label: 'Not running',
    detail:
      'No election is in progress. On Polymesh the validator set is permissioned, and the set for the next era is chosen during the era’s final session.',
  },
  Signed: {
    label: 'Accepting solutions',
    detail: 'The election is open for signed solutions from off-chain submitters.',
  },
  Unsigned: {
    label: 'Validators submitting',
    detail: 'The signed phase has closed; validators are submitting unsigned solutions.',
  },
  Emergency: {
    label: 'Emergency',
    detail:
      'The election failed to produce a solution and has fallen back to emergency handling. The validator set is not changing normally.',
  },
  Unknown: {
    label: 'Not reported',
    detail:
      'This runtime does not expose an election phase, so nothing is claimed about one. Better than reporting “off” for machinery that may not exist.',
  },
};

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--gridline)' }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, value * 100)}%`, background: 'var(--series-1)' }}
      />
    </div>
  );
}

function Cell({
  label,
  value,
  children,
  tip,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  tip?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
        {tip ? <InfoTip label={`About ${label}`}>{tip}</InfoTip> : null}
      </div>
      <p className="mt-1 mb-0 text-2xl leading-8 font-semibold tabular">{value}</p>
      {children}
    </div>
  );
}

export function EraStatus() {
  const latest = useLatest();
  const clock = useEraClock(latest.data?.eraStatus);
  const data = latest.data;
  const status = data?.eraStatus;

  if (!data || !status || !clock) {
    return <Skeleton height={220} label="Loading era status" />;
  }

  const phase = PHASE_COPY[status.electionPhase];
  const asOf = <AsOf label={formatDateTime(data.generatedAt)} />;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Cell
        label="Current era"
        value={formatNumber(data.activeEra)}
        tip={
          <>
            The era now running. An era is {formatNumber(status.sessionsPerEra)} sessions — 24 hours
            on Polymesh — and is the unit everything in staking is measured in: rewards are
            calculated per era, and the validator set is fixed for its duration.
            {status.currentEra > data.activeEra ? (
              <>
                <br />
                <br />
                Era {formatNumber(status.currentEra)} is already <em>planned</em>: its validator set
                has been chosen and takes effect at the next boundary.
              </>
            ) : null}
          </>
        }
      >
        <Meter value={clock.progress} label="Era progress" />
        <p className="mt-2 mb-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {formatPercent(clock.progress, { decimals: 0 })} elapsed ·{' '}
          {clock.overdue ? 'ending now' : `${formatDuration(clock.secondsRemaining)} left`}
        </p>
      </Cell>

      <Cell
        label="Era ends"
        value={formatDateTime(clock.endsAt.toISOString(), { timeOnly: true })}
        tip={
          <>
            When this era ends, in your local time. Rewards for it are calculated and paid out
            shortly after — which is why a payout for today’s work lands tomorrow.
          </>
        }
      >
        <p className="mt-2 mb-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          started {formatDateTime(clock.startsAt.toISOString())}
        </p>
        <p className="mt-0.5 mb-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          ends {formatDateTime(clock.endsAt.toISOString())}
        </p>
      </Cell>

      <Cell
        label="Session"
        value={`${clock.session.indexInEra} of ${clock.session.perEra}`}
        tip={
          <>
            Sessions divide an era — {formatNumber(status.sessionsPerEra)} of them here, so four
            hours each. Block authoring duties are shuffled at every session boundary, and the
            chain’s absolute session index is {formatNumber(clock.session.absolute)}.
            <br />
            <br />
            Derived from the era’s start against your clock rather than read from the snapshot, so
            it advances between updates instead of jumping.
          </>
        }
      >
        <Meter value={clock.session.progress} label="Session progress" />
        <p className="mt-2 mb-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {formatPercent(clock.session.progress, { decimals: 0 })} elapsed ·{' '}
          {formatDuration(clock.session.secondsRemaining)} left
        </p>
      </Cell>

      <Cell
        label="Election"
        value={phase.label}
        tip={
          <>
            {phase.detail}
            <br />
            <br />
            {clock.session.isFinal
              ? 'This is the era’s final session, so the next era’s validator set is being settled now.'
              : `The next set is chosen in the era’s final session, which begins in ${formatDuration(
                  clock.secondsRemaining - clock.session.secondsRemaining >= 0
                    ? clock.secondsRemaining - clock.session.secondsRemaining
                    : 0,
                )}.`}
          </>
        }
      >
        <p className="mt-2 mb-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {clock.session.isFinal
            ? 'final session — next set being chosen'
            : `${formatNumber(data.validatorCount.active)} of ${formatNumber(
                data.validatorCount.max,
              )} slots filled`}
        </p>
        <p className="mt-1 mb-0">{asOf}</p>
      </Cell>
    </div>
  );
}
