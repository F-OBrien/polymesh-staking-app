'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useEraIndex, useEraSeries, useLatest, useManifest, useOperators } from '@/lib/data/queries';
import { useResolvedRange } from '@/components/era-range-control';
import { useNow } from '@/lib/data/use-era-clock';
import { useLive } from '@/lib/data/use-live';
import {
  useRewardHistory,
  useRewardTotals,
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
import { looksLikeAddress } from '@/lib/chain/wallet';
import { explorerAccountUrl } from '@/config/networks';
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
  const [showHistory, setShowHistory] = useState(false);

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

  // Needs the *first* payout's date to know over how long, which only the
  // detail walk provides — so this stays null until the history is loaded
  // rather than being computed against an unknown period.
  const realised = useMemo(() => {
    const bonded = position.data?.active;
    const first = summary.first?.datetime;
    if (bonded == null || first == null || first === 0) return null;
    const days = Math.max(1, (now / 1000 - first) / DAY);
    return realisedApr({ rewards: summary.total, bonded, days });
  }, [position.data, summary, now]);

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
            <code style={{ fontFamily: 'var(--font-mono)' }}>{truncateAddress(stash, 8, 8)}</code>
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
              hint="backing nominations right now"
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
        <p className="mt-2 mb-0 max-w-[68ch] text-sm" style={{ color: 'var(--text-secondary)' }}>
          Every payout actually received, from the chain&rsquo;s event history — not an estimate.
        </p>

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
                hint={
                  showHistory
                    ? 'earned so far, against what is bonded now'
                    : 'needs the full history below'
                }
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
                  summary.last?.datetime
                    ? formatRelativeTime(new Date(summary.last.datetime * 1000).toISOString())
                    : '—'
                }
                hint={
                  summary.last?.datetime
                    ? formatDateTime(new Date(summary.last.datetime * 1000).toISOString())
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
                  onClick={() => setShowHistory(true)}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
                >
                  Load full payout history
                </button>
                <p className="mt-2 mb-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatNumber(payoutCount)} payouts — about{' '}
                  {formatNumber(pagesFor(payoutCount))} requests to the indexer. Needed for the
                  chart, the per-era breakdown and the CSV.
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
                  csv={() => rewardsToCsv(rewards.data?.events ?? [], tokenDecimals)}
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
          <NominationsTable rows={myOperators} addresses={nominations} />
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
function NominationsTable({
  rows,
  addresses,
}: {
  rows: readonly OperatorRow[];
  addresses: readonly string[];
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
          {addresses.length === 1 ? '' : 's'}. Warnings flag anything worth acting on.
        </caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th scope="col" className="p-2 text-left font-medium">
              Operator
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
                  <Link href={`/operators/${row.address}/`}>{row.nodeLabel}</Link>
                </th>
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
                <code style={{ fontFamily: 'var(--font-mono)' }}>{truncateAddress(address)}</code>
              </th>
              <td className="p-2 text-right">—</td>
              <td className="p-2 text-right">—</td>
              <td className="p-2" style={{ color: 'var(--text-muted)' }}>
                No data — not in the current set or our history
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
