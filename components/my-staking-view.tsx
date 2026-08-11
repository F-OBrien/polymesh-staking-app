'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  useEraIndex,
  useEraSeries,
  useLatest,
  useManifest,
  useOperators,
} from '@/lib/data/queries';
import { useResolvedRange } from '@/components/era-range-control';
import { useNow } from '@/lib/data/use-era-clock';
import { useLive } from '@/lib/data/use-live';
import {
  useRewardHistory,
  useRewardTotals,
  useStakeAllocation,
  useStashAddress,
  useStashPosition,
  useWallet,
} from '@/lib/data/use-stash';
import { buildOperatorRows, type OperatorRow } from '@/lib/data/operator-rows';
import {
  cumulativeRewards,
  realisedApr,
  rewardsByDay,
  pagesFor,
  rewardsToCsv,
  summariseRewards,
} from '@/lib/indexer/rewards';
import { LiveToggle } from '@/components/live-toggle';
import { StatTile } from '@/components/stat-tile';
import { AsOf, EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Sparkline } from '@/components/charts/sparkline';
import { idleStake, type TargetAllocation } from '@/lib/chain/allocation';
import { buildLabeller } from '@/lib/data/operator-label';
import { CopyAddress } from '@/components/copy-address';
import { looksLikeAddress } from '@/lib/chain/wallet';
import { explorerAccountUrl, explorerEventUrl } from '@/config/networks';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPolyx,
  formatRelativeTime,
  truncateAddress,
} from '@/lib/format';

/**
 * One person's staking position.
 *
 * **The disconnected state is the design problem here, not the connected one.**
 * Most staking dashboards render a wall with a Connect button, which is useless
 * to anyone evaluating the chain, anyone on a phone without an extension, and
 * anyone who simply wants to look at an address. So this page always shows what
 * it can: paste any stash and get its full position and payout history, with no
 * wallet involved.
 *
 * Reward history comes from the indexer over plain `fetch`, so that half works
 * with none of the Polkadot stack loaded. Only the on-chain position — bonded,
 * unbonding, nominations — needs a socket, and it opens on demand.
 */

const DAY = 86_400;

export function MyStakingView() {
  const { stash, setStash, clear } = useStashAddress();
  const wallet = useWallet();
  // `Date.now()` during render is impure and unstable across re-renders; every
  // duration on this page is measured against this instead.
  const now = useNow();
  const manifest = useManifest();
  const latest = useLatest();
  const registry = useOperators();
  const range = useResolvedRange(manifest.data);
  const { series } = useEraSeries(range);

  const activeEra = latest.data?.activeEra;
  const position = useStashPosition(stash, activeEra);

  /**
   * Reward history, in two stages.
   *
   * The totals are one request. The event-by-event walk is one request per 100
   * payouts — 119 of them for a real account we measured — so it is held back
   * until a reader asks for the detail. Everything above the fold comes from
   * the cheap query.
   */
  const totals = useRewardTotals(stash);

  /**
   * Which address the reader asked for full history on — not a boolean.
   *
   * A plain `showHistory` flag stayed true when the address changed, so pasting
   * a second stash silently kicked off a 119-request walk nobody asked for.
   * Storing the address it was granted for makes the reset structural rather
   * than something an effect has to remember.
   */
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const showHistory = historyFor === stash && stash !== '';

  // 34 KB, fetched only alongside the detail: it is what fills in which era
  // each payout was earned in, and it is useless without the events.
  const eraIndex = useEraIndex(showHistory);
  const rewards = useRewardHistory(stash, {
    enabled: showHistory,
    eraIndex: eraIndex.data,
  });

  // Live defaults on once a wallet is connected: that user has already paid for
  // `@polkadot/api`, so the subscription costs them nothing extra (§6.6a).
  const live = useLive({ stash, defaultEnabled: wallet.accounts.length > 0 });

  const tokenDecimals = manifest.data?.chain.tokenDecimals ?? 6;
  const toPolyx = (value: bigint) => Number(value) / 10 ** tokenDecimals;

  const summary = useMemo(() => summariseRewards(rewards.data?.events ?? []), [rewards.data]);

  // Prefer the server-side aggregate; fall back to the walk's own sum once it
  // has run. The two are verified to agree exactly on real data.
  const lifetimeTotal = totals.data?.total ?? summary.total;
  const payoutCount = totals.data?.count ?? summary.count;
  // The first and last payout come back with the totals, in the same request,
  // so neither of these has to wait on the full walk.
  const firstPayout = totals.data?.first ?? summary.first;
  const lastPayout = totals.data?.last ?? summary.last;

  const daily = useMemo(() => rewardsByDay(rewards.data?.events ?? []), [rewards.data]);
  const cumulative = useMemo(() => cumulativeRewards(daily), [daily]);

  const operatorRows = useMemo(
    () =>
      buildOperatorRows({
        series,
        latest: latest.data,
        registry: registry.data,
        erasPerYear: manifest.data?.erasPerYear ?? 365,
      }),
    [series, latest.data, registry.data, manifest.data],
  );

  // Live nominations win over the snapshot read when the socket is up — this is
  // the tier-4 "upgrade in place" in action. Memoised so the `??` chain does not
  // produce a fresh array on every render and re-run everything below it.
  const nominations = useMemo(
    () => live.state.nominations ?? position.data?.nominations ?? [],
    [live.state.nominations, position.data],
  );

  const myOperators = useMemo(
    () => nominations.flatMap((address) => operatorRows.filter((row) => row.address === address)),
    [nominations, operatorRows],
  );

  /**
   * What the election actually did with the bond.
   *
   * Distinct from the nomination list in a way that is easy to miss: Phragmén
   * assigns a nominator's stake to a *subset* of their targets, so eight
   * nominations commonly means backing one. And stake bonded or nominated since
   * the last election is not in this era's exposure at all.
   */
  const labelOf = useMemo(() => buildLabeller(registry.data), [registry.data]);
  const allocation = useStakeAllocation(stash, activeEra, nominations);
  const currentTargets = allocation.data?.current.targets;
  const assignedByOperator = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const target of currentTargets ?? []) map.set(target.address, target.value);
    return map;
  }, [currentTargets]);

  const assigned = allocation.data?.current.assigned ?? null;
  // Operators still holding this stash's stake that it no longer nominates —
  // the result of re-nominating mid-era. They are earning, and the old UI
  // could not see them at all.
  const unnominatedHolders = useMemo(
    () => (currentTargets ?? []).filter((t) => !t.nominated && t.value > 0n),
    [currentTargets],
  );
  // The era the allocation was actually read at — from the chain, which can be
  // one ahead of the snapshot's `activeEra` across a boundary. Every label in
  // this section uses it, so the number on screen and the era named beside it
  // can never disagree.
  const allocationEra = allocation.data?.current.era ?? null;
  const idle = position.data && assigned != null ? idleStake(position.data.active, assigned) : null;
  const previousAssigned = allocation.data?.previous?.assigned ?? null;

  // Needs the *first* payout's date to know over how long, which only the
  // detail walk provides — so this stays null until the history is loaded
  // rather than being computed against an unknown period.
  const realised = useMemo(() => {
    const bonded = position.data?.active;
    const first = firstPayout?.datetime;
    if (bonded == null || first == null || first === 0) return null;
    const days = Math.max(1, (now / 1000 - first) / DAY);
    return realisedApr({ rewards: lifetimeTotal, bonded, days });
  }, [position.data, firstPayout, lifetimeTotal, now]);

  if (stash === '') {
    return <Disconnected wallet={wallet} onUseAddress={setStash} onPickAccount={setStash} />;
  }

  const networkApr = series ? (series.network.avgApr.at(-1) ?? null) : null;
  const asOf = latest.data ? <AsOf label={formatRelativeTime(latest.data.generatedAt)} /> : null;

  return (
    <>
      <header className="mt-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
            Showing
          </p>
          <h2 className="m-0 flex flex-wrap items-baseline gap-x-3 text-xl font-semibold">
            <CopyAddress address={stash} head={8} tail={8} label="this stash" />
            <a
              href={explorerAccountUrl(stash)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-normal"
              style={{ color: 'var(--text-secondary)' }}
            >
              Subscan ↗
            </a>
            <button
              type="button"
              onClick={clear}
              className="text-sm font-normal underline"
              style={{ color: 'var(--text-muted)' }}
            >
              use a different address
            </button>
          </h2>
        </div>
        <LiveToggle live={live} />
      </header>

      {position.isError ? (
        <div className="mt-6">
          <ErrorState
            title="Could not read this position from the chain"
            message="Reward history below may still be available — it comes from a different source."
            onRetry={() => void position.refetch()}
          />
        </div>
      ) : null}

      <section aria-labelledby="position" className="mt-8">
        <h2 id="position" className="m-0 text-[22px] leading-7 font-semibold tracking-tight">
          Position
        </h2>

        {position.isLoading ? (
          <div className="mt-4">
            <Skeleton height={120} label="Reading position from the chain" />
          </div>
        ) : position.data && !position.data.isBonded ? (
          <div className="mt-4">
            <EmptyState
              title="This address has nothing bonded"
              message="It may never have staked, or it may have withdrawn everything. Reward history below still shows anything it earned in the past."
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              emphasis
              label="Bonded and active"
              value={position.data ? formatPolyx(toPolyx(position.data.active)) : '—'}
              hint="not unbonding — but see what is assigned"
            />
            {/* The number people assume "bonded" already means. It does not:
                the election decides how much of a bond is actually exposed,
                and stake bonded since the last election is exposed not at all. */}
            <StatTile
              label={`Assigned this era`}
              value={assigned == null ? '—' : formatPolyx(toPolyx(assigned))}
              hint={
                allocation.isLoading
                  ? 'reading exposure…'
                  : idle != null && idle > 0n
                    ? `${formatPolyx(toPolyx(idle))} not earning`
                    : allocationEra != null
                      ? `all of it, in era ${allocationEra}`
                      : undefined
              }
            />
            <StatTile
              label="Unbonding"
              value={
                position.data
                  ? formatPolyx(
                      toPolyx(position.data.unbonding.reduce((sum, c) => sum + c.value, 0n)),
                    )
                  : '—'
              }
              hint={
                position.data && position.data.unbonding.length > 0
                  ? `${position.data.unbonding.length} chunk${position.data.unbonding.length === 1 ? '' : 's'}`
                  : 'nothing unbonding'
              }
            />
            <StatTile
              label="Withdrawable now"
              value={position.data ? formatPolyx(toPolyx(position.data.redeemable)) : '—'}
              hint={
                position.data && position.data.redeemable > 0n
                  ? 'already matured'
                  : 'nothing has matured'
              }
            />
            <StatTile
              label="Rewards paid to"
              value={describePayee(position.data?.rewardDestination).value}
              hint={describePayee(position.data?.rewardDestination).hint}
            />
          </div>
        )}

        {position.data && position.data.unbonding.length > 0 ? (
          <UnbondingTable
            chunks={position.data.unbonding}
            activeEra={live.state.activeEra ?? activeEra ?? 0}
            eraDurationSeconds={DAY}
            now={now}
            toPolyx={toPolyx}
          />
        ) : null}
      </section>

      <section aria-labelledby="earned" className="mt-12">
        <h2 id="earned" className="m-0 text-[22px] leading-7 font-semibold tracking-tight">
          What this address has earned
        </h2>

        {totals.isError || rewards.isError ? (
          <div className="mt-4">
            <ErrorState
              title="Could not load reward history"
              message={
                ((totals.error ?? rewards.error) as Error | null)?.message ??
                'The indexer did not respond.'
              }
              onRetry={() => {
                void totals.refetch();
                if (showHistory) void rewards.refetch();
              }}
            />
          </div>
        ) : totals.isLoading ? (
          <div className="mt-4">
            <Skeleton height={160} label="Loading reward totals" />
          </div>
        ) : payoutCount === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No payouts on record"
              message="This address has never received a staking reward, at least as far back as the indexer goes."
            />
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                emphasis
                label="Total earned"
                value={formatPolyx(toPolyx(lifetimeTotal))}
                hint={
                  rewards.data?.truncated
                    ? 'at least — history was truncated'
                    : `across ${formatNumber(payoutCount)} payouts`
                }
              />
              <StatTile
                label="Realised return"
                value={realised == null ? '—' : formatPercent(realised, { decimals: 2 })}
                hint="earned so far, against what is bonded now"
              />
              <StatTile
                label="Network average"
                value={formatPercent(networkApr, { decimals: 2 })}
                hint="most recent era, for comparison"
                footer={asOf}
              />
              <StatTile
                label="Last payout"
                value={
                  lastPayout?.datetime
                    ? formatRelativeTime(new Date(lastPayout.datetime * 1000).toISOString())
                    : '—'
                }
                hint={
                  lastPayout?.datetime
                    ? formatDateTime(new Date(lastPayout.datetime * 1000).toISOString())
                    : undefined
                }
              />
            </div>

            {/* The detail walk, behind an explicit choice.
                It is one request per 100 payouts against a public endpoint,
                and the figures above already answer "how much have I earned".
                The button states the cost rather than hiding it. */}
            {!showHistory ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setHistoryFor(stash)}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
                >
                  Load full payout history
                </button>
                <p className="mt-2 mb-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatNumber(payoutCount)} payouts — about {formatNumber(pagesFor(payoutCount))}{' '}
                  requests to the indexer. Needed for the chart, the per-era breakdown and the CSV.
                </p>
              </div>
            ) : rewards.isLoading ? (
              <div className="mt-4">
                <Skeleton height={160} label="Loading payout history" />
              </div>
            ) : cumulative.length > 1 ? (
              <figure
                className="mt-4 m-0 rounded-[var(--radius-md)] border p-4"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
              >
                <figcaption className="mb-2 text-sm font-medium">
                  Cumulative rewards
                  <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>
                    {formatDateTime(new Date(cumulative[0]!.day * 1000).toISOString())} to today
                  </span>
                </figcaption>
                {/* Still a sparkline, and still inadequate: a monotonic
                    cumulative line with no axis always slopes up and to the
                    right, so it shows a shape without showing a quantity.
                    Replacing it with the design doc's C23 — per-period bars on
                    a shared axis with the cumulative line — is the next piece
                    of work here. */}
                <Sparkline
                  values={cumulative.map((point) => toPolyx(point.amount))}
                  width={640}
                  height={72}
                  colour="var(--series-1)"
                  strokeWidth={2}
                />
              </figure>
            ) : null}

            {rewards.data?.truncated ? (
              <p className="mt-3 mb-0 text-sm" style={{ color: 'var(--status-warning)' }}>
                This history was long enough to hit our page limit, so the total above is a floor
                rather than a complete figure.
              </p>
            ) : null}

            {showHistory && (rewards.data?.events.length ?? 0) > 0 ? (
              <div className="mt-4">
                <ExportButton
                  stash={stash}
                  csv={() =>
                    rewardsToCsv(rewards.data?.events ?? [], tokenDecimals, explorerEventUrl)
                  }
                />
              </div>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="my-operators" className="mt-12">
        <h2 id="my-operators" className="m-0 text-[22px] leading-7 font-semibold tracking-tight">
          Operators backed
        </h2>

        {position.isLoading ? (
          <div className="mt-4">
            <Skeleton height={200} label="Loading nominations" />
          </div>
        ) : position.isError ? (
          // "No nominations" and "we could not read the nominations" are
          // completely different facts, and showing the first when the second
          // is true would tell someone they are earning nothing when they are.
          <div className="mt-4">
            <EmptyState
              title="Could not read nominations"
              message="The chain did not respond, so we cannot say which operators this address backs. This is usually temporary."
            />
          </div>
        ) : nominations.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Not currently nominating"
              message="This address has no active nominations, so it is not earning staking rewards."
              action={
                <Link href="/operators/" className="mt-1 text-sm">
                  Find operators
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <AllocationNote
              activeEra={allocationEra}
              assigned={assigned}
              idle={idle}
              previousAssigned={previousAssigned}
              backing={
                allocation.data?.current.targets.filter((t) => t.nominated && t.value > 0n)
                  .length ?? null
              }
              nominated={nominations.length}
              unnominated={allocation.data?.current.unnominated ?? null}
              unnominatedCount={unnominatedHolders.length}
              toPolyx={toPolyx}
            />
            <NominationsTable
              rows={myOperators}
              addresses={nominations}
              assignedByOperator={assignedByOperator}
              unnominatedHolders={unnominatedHolders}
              registryLabel={labelOf}
              toPolyx={toPolyx}
              loading={allocation.isLoading}
            />
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Disconnected
// ---------------------------------------------------------------------------

/**
 * What the page shows before an address is chosen.
 *
 * Not a wall. It states what the page will do, offers the wallet if one is
 * available, and — equally prominent — takes any address. The address route is
 * not a fallback for the unlucky: it is how anyone inspects an account that is
 * not theirs, which is most of the reason to look at a staking page at all.
 */
function Disconnected({
  wallet,
  onUseAddress,
  onPickAccount,
}: {
  wallet: ReturnType<typeof useWallet>;
  onUseAddress: (address: string) => void;
  onPickAccount: (address: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = looksLikeAddress(draft);

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-2">
      <section
        aria-labelledby="by-address"
        className="rounded-[var(--radius-md)] border p-5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <h2 id="by-address" className="m-0 text-[17px] leading-6 font-semibold">
          Look up any address
        </h2>
        <p className="mt-1 mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          No wallet needed. Paste a stash address to see its position, its nominations and every
          reward it has been paid.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (valid) onUseAddress(draft);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="stash-input" className="sr-only">
            Stash address
          </label>
          <input
            id="stash-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="2H…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={touched && draft !== '' && !valid}
            aria-describedby="stash-help"
            className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
            style={{
              borderColor:
                touched && draft !== '' && !valid ? 'var(--status-critical)' : 'var(--border)',
              background: 'var(--page-plane)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <p id="stash-help" className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
            {touched && draft !== '' && !valid
              ? 'That does not look like a Polymesh address — they are 47–48 characters and start with a digit or letter.'
              : 'Read-only. This site never asks you to sign anything.'}
          </p>
          <button
            type="submit"
            disabled={!valid}
            className="self-start rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
          >
            Look up
          </button>
        </form>
      </section>

      <section
        aria-labelledby="by-wallet"
        className="rounded-[var(--radius-md)] border p-5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <h2 id="by-wallet" className="m-0 text-[17px] leading-6 font-semibold">
          Or connect a wallet
        </h2>
        <p className="mt-1 mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Saves pasting. This site is read-only — connecting reveals your addresses and nothing
          else, and you will never be asked to sign.
        </p>

        {wallet.accounts.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {wallet.accounts.map((account) => (
              <li key={`${account.source}:${account.address}`}>
                <button
                  type="button"
                  onClick={() => onPickAccount(account.address)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="truncate font-medium">{account.name}</span>
                  <span
                    className="shrink-0 text-xs"
                    style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    {truncateAddress(account.address)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting}
              className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
            >
              {wallet.connecting ? 'Waiting for the extension…' : 'Connect wallet'}
            </button>
            {wallet.error ? (
              <p className="mt-3 mb-0 text-sm" style={{ color: 'var(--status-critical)' }}>
                {wallet.error.message}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function UnbondingTable({
  chunks,
  activeEra,
  eraDurationSeconds,
  now,
  toPolyx,
}: {
  chunks: readonly { era: number; value: bigint }[];
  activeEra: number;
  eraDurationSeconds: number;
  /** Milliseconds, from `useNow` — never `Date.now()` during render. */
  now: number;
  toPolyx: (value: bigint) => number;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <caption className="pb-2 text-left" style={{ color: 'var(--text-muted)' }}>
          Unbonding chunks and when each becomes withdrawable.
        </caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th scope="col" className="p-2 text-left font-medium">
              Unlocks at era
            </th>
            <th scope="col" className="p-2 text-left font-medium">
              Approximately
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {chunks.map((chunk) => {
            const erasAway = chunk.era - activeEra;
            const when =
              erasAway <= 0
                ? 'available now'
                : formatDateTime(
                    new Date(now + erasAway * eraDurationSeconds * 1000).toISOString(),
                  );
            return (
              <tr key={chunk.era} style={{ borderTop: '1px solid var(--border)' }}>
                <th scope="row" className="p-2 text-left font-normal">
                  {formatNumber(chunk.era)}
                </th>
                <td className="p-2">{when}</td>
                <td className="p-2 text-right">{formatPolyx(toPolyx(chunk.value))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Nominated operators, with a warning row for anything that should change a
 * decision.
 *
 * The warnings are the point. A nominator's realistic failure modes are backing
 * an operator whose page is full (earning nothing), one that has stopped being
 * elected, or one that quietly raised its commission — none of which announces
 * itself. §9.6 asks for exactly this.
 */
/**
 * Why the numbers below may not be what the nomination list implies.
 *
 * Two things surprise people, and neither is a fault:
 *
 *  - **Nominating eight operators does not mean backing eight.** The election
 *    optimises the network's stake spread, not the nominator's, and commonly
 *    puts a whole bond behind one target. Observed on mainnet: 2,019,000 POLYX
 *    across eight elected operators, all of it assigned to one.
 *  - **Rewards arriving now are for the previous era.** So a stash that was
 *    assigned nothing last era earns nothing today, even though everything
 *    looks correct on screen.
 *
 * Only rendered when there is something to say, so a straightforward position
 * gets no lecture.
 */
function AllocationNote({
  activeEra,
  assigned,
  idle,
  previousAssigned,
  backing,
  nominated,
  unnominated,
  unnominatedCount,
  toPolyx,
}: {
  activeEra: number | null;
  assigned: bigint | null;
  idle: bigint | null;
  previousAssigned: bigint | null;
  backing: number | null;
  nominated: number;
  /** Stake held by operators no longer nominated. */
  unnominated: bigint | null;
  unnominatedCount: number;
  toPolyx: (value: bigint) => number;
}) {
  if (assigned == null) return null;

  const notes: string[] = [];

  // Said first, because it is the one that otherwise looks like a bug: the
  // nomination list and the stake do not agree, and both are correct.
  if (unnominated != null && unnominated > 0n) {
    notes.push(
      `${formatPolyx(toPolyx(unnominated))} POLYX is still staked with ` +
        `${unnominatedCount === 1 ? 'an operator' : `${unnominatedCount} operators`} no longer ` +
        `nominated. Changing nominations does not move stake that is already exposed — the ` +
        `election fixed it for this era, and it moves at the next one. It is still earning in ` +
        `the meantime.`,
    );
  }

  if (backing != null && backing > 0 && backing < nominated) {
    notes.push(
      `The election put this stake behind ${backing} of the ${nominated} operators nominated. ` +
        `That is normal — it optimises the network’s spread of stake, not yours — but it does mean ` +
        `nominating more operators is not by itself diversification.`,
    );
  }

  if (backing === 0) {
    notes.push(
      `None of this stake is backing an operator in the current era. That happens when a ` +
        `nomination was made during this era, or when no nominated operator was elected.`,
    );
  }

  if (idle != null && idle > 0n && backing !== 0) {
    notes.push(
      `${formatPolyx(toPolyx(idle))} POLYX is bonded but not assigned this era, so it is not ` +
        `earning. Stake bonded after the last election joins at the next one.`,
    );
  }

  if (previousAssigned === 0n && assigned > 0n) {
    notes.push(
      `Payouts landing now are for era ${activeEra == null ? 'the previous era' : activeEra - 1}, ` +
        `when none of this stake was assigned — so expect nothing from them, even though it is ` +
        `earning in the era now running.`,
    );
  }

  if (notes.length === 0) return null;

  return (
    <ul
      className="mt-4 mb-0 flex list-none flex-col gap-2 rounded-[var(--radius-md)] border p-3 text-sm"
      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
    >
      {notes.map((note) => (
        <li key={note}>
          <span aria-hidden="true">•</span> {note}
        </li>
      ))}
    </ul>
  );
}

function NominationsTable({
  rows,
  addresses,
  assignedByOperator,
  unnominatedHolders,
  registryLabel,
  toPolyx,
  loading,
}: {
  rows: readonly OperatorRow[];
  addresses: readonly string[];
  assignedByOperator: ReadonlyMap<string, bigint>;
  /** Operators holding stake that this stash no longer nominates. */
  unnominatedHolders: readonly TargetAllocation[];
  registryLabel: (address: string) => string;
  toPolyx: (value: bigint) => number;
  loading: boolean;
}) {
  // An address with no row is one we hold no data for — still shown, because
  // silently dropping a nomination would misrepresent the position.
  const unknown = addresses.filter((address) => !rows.some((row) => row.address === address));

  return (
    <div className="mt-4 overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <caption className="pb-2 text-left" style={{ color: 'var(--text-muted)' }}>
          {formatNumber(addresses.length)} nomination
          {addresses.length === 1 ? '' : 's'}
          {unnominatedHolders.length > 0
            ? `, plus ${formatNumber(unnominatedHolders.length)} operator${
                unnominatedHolders.length === 1 ? '' : 's'
              } still holding stake from a previous era`
            : ''}
          . Warnings flag anything worth acting on.
        </caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th scope="col" className="p-2 text-left font-medium">
              Operator
            </th>
            {/* The column that turns a list of intentions into a list of
                facts: which of these operators the stake is actually behind. */}
            <th scope="col" className="p-2 text-right font-medium">
              Assigned this era
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Return
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Commission
            </th>
            <th scope="col" className="p-2 text-left font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const warnings = nominationWarnings(row);
            return (
              <tr key={row.address} style={{ borderTop: '1px solid var(--border)' }}>
                <th scope="row" className="p-2 text-left font-normal">
                  <Link href={`/operators/${row.address}/`}>{row.name}</Link>
                  <CopyAddress
                    address={row.address}
                    label={row.name}
                    className="ms-2 align-middle text-xs"
                  />
                </th>
                <td className="p-2 text-right">
                  {loading ? (
                    <span style={{ color: 'var(--text-muted)' }}>…</span>
                  ) : (assignedByOperator.get(row.address) ?? 0n) > 0n ? (
                    formatPolyx(toPolyx(assignedByOperator.get(row.address)!))
                  ) : (
                    <span
                      style={{ color: 'var(--text-muted)' }}
                      title="The election did not put any of this stake behind this operator for the current era"
                    >
                      none
                    </span>
                  )}
                </td>
                <td className="p-2 text-right">{formatPercent(row.aprMean, { decimals: 2 })}</td>
                <td className="p-2 text-right">{formatPercent(row.commission, { decimals: 2 })}</td>
                <td className="p-2">
                  {warnings.length === 0 ? (
                    <span style={{ color: 'var(--text-muted)' }}>Nothing to flag</span>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                      {warnings.map((warning) => (
                        <li key={warning} style={{ color: 'var(--status-warning)' }}>
                          {/* Icon plus text: never colour alone. */}
                          <span aria-hidden="true">▲</span> {warning}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
          {unknown.map((address) => (
            <tr key={address} style={{ borderTop: '1px solid var(--border)' }}>
              <th scope="row" className="p-2 text-left font-normal">
                <CopyAddress address={address} />
              </th>
              <td className="p-2 text-right">—</td>
              <td className="p-2 text-right">—</td>
              <td className="p-2" style={{ color: 'var(--text-muted)' }}>
                No data — not in the current set or our history
              </td>
            </tr>
          ))}
          {/* Operators that still hold this stash's stake but are no longer
              nominated. Omitting them would show a position as unassigned when
              it is earning normally — and this row is the whole explanation. */}
          {unnominatedHolders.map((holder) => (
            <tr key={holder.address} style={{ borderTop: '1px solid var(--border)' }}>
              <th scope="row" className="p-2 text-left font-normal">
                <Link href={`/operators/${holder.address}/`}>{registryLabel(holder.address)}</Link>
                <CopyAddress
                  address={holder.address}
                  label={registryLabel(holder.address)}
                  className="ms-2 align-middle text-xs"
                />
              </th>
              <td className="p-2 text-right">{formatPolyx(toPolyx(holder.value))}</td>
              <td className="p-2 text-right">—</td>
              <td className="p-2 text-right">—</td>
              <td className="p-2">
                <span style={{ color: 'var(--status-warning)' }}>
                  <span aria-hidden="true">▲</span> No longer nominated — still staked here until
                  the next era
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders a reward destination.
 *
 * `readPayee` returns either a variant name (`Staked`, `Stash`, `Controller`)
 * or, for the `Account` variant, a full 48-character address — which is the
 * useful answer but overflows a stat tile, so it is truncated here and the
 * whole thing carried in the hint.
 *
 * Only `Staked` compounds, and that is the distinction a user acts on, so it is
 * stated in words rather than left to be inferred from the variant name.
 */
function describePayee(destination: string | null | undefined): { value: string; hint: string } {
  if (destination == null) return { value: '—', hint: 'not known' };
  if (destination === 'Staked') {
    return { value: 'Staked', hint: 'added to the bond — compounding' };
  }
  // Anything that is not a known unit variant is an address.
  if (destination !== 'Stash' && destination !== 'Controller') {
    return {
      value: truncateAddress(destination),
      hint: 'paid to another account — not compounding',
    };
  }
  return { value: destination, hint: 'paid out free — not compounding' };
}

/**
 * What would make a nominator want to move.
 *
 * Note what is *not* here: a warning about the operator's nominator page being
 * full. Polymesh rewards every exposure page and pays them automatically, so
 * telling someone they "may be earning nothing" because an operator is popular
 * would push them off a perfectly good node for no reason.
 */
function nominationWarnings(row: OperatorRow): string[] {
  const warnings: string[] = [];
  if (row.status !== 'active') {
    warnings.push(
      row.status === 'waiting' ? 'Not elected this era' : 'Not in the active set at all',
    );
  }
  if (row.blocked) warnings.push('Blocked to new nominations');
  if (row.commission != null && row.commission >= 0.2) {
    warnings.push(`Commission is high at ${formatPercent(row.commission, { decimals: 1 })}`);
  }
  return warnings;
}

/**
 * CSV download.
 *
 * Built on click rather than up front: it is a few hundred kilobytes of string
 * for a long history, and most visitors never press it.
 */
function ExportButton({ stash, csv }: { stash: string; csv: () => string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const blob = new Blob([csv()], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `polymesh-rewards-${stash.slice(0, 8)}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      }}
      className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm"
      style={{ borderColor: 'var(--border)' }}
    >
      Download reward history (CSV)
    </button>
  );
}
