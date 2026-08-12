'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useLatest, useManifest, useOffences, useOperators, useSlashes } from '@/lib/data/queries';
import { LazyChart, LazyXyLineChart } from '@/components/charts/lazy-chart';
import { StatTile } from '@/components/stat-tile';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import {
  firstPenalisedOffenderCount,
  penaltyCurves,
  unresponsivenessPenalty,
} from '@/lib/metrics/slashing';
import { formatNumber, formatPercent, formatPolyx, truncateAddress } from '@/lib/format';
import { explorerBlockUrl } from '@/config/networks';
import type { OffenceReport, SlashEvent, SlashingScope } from '@/lib/schemas/data';

/**
 * Offences, and the penalty model behind them.
 *
 * Three parts, in this order deliberately.
 *
 * **What was reported** comes first, because it is the record of conduct and it
 * is not empty: 36 incidents against 21 operators over the chain's life.
 *
 * **What it cost** comes second, and on Polymesh the answer is nothing at all.
 * That ordering matters. Built from `validatorSlashInEra`, the cost record is
 * empty — and led on its own it reads as "no operator has ever done anything
 * wrong", which flatters every node that has ever been offline.
 *
 * **What could happen** comes last: the two penalty curves the previous app
 * showed as `FineCurves`, unlabelled, in the Overview tab, where they were easy
 * to mistake for history. They are worth keeping because both penalties are
 * superlinear in how many operators fail *together* — the reason spreading
 * nominations across independent operators matters — but only with that said
 * out loud.
 */
export function SlashingView() {
  const slashes = useSlashes();
  const registry = useOperators();
  const latest = useLatest();
  const manifest = useManifest();

  const validatorCount = latest.data?.validatorCount.active ?? 0;

  const curves = useMemo(() => penaltyCurves(validatorCount), [validatorCount]);
  const allowance = useMemo(
    () => firstPenalisedOffenderCount(validatorCount, unresponsivenessPenalty),
    [validatorCount],
  );

  // Memoised rather than defaulted inline: a fresh `[]` on every render would
  // re-run the totals below each time the component painted.
  const events = useMemo(() => slashes.data?.events ?? [], [slashes.data]);
  const nameOf = (address: string) => registry.data?.[address]?.name ?? truncateAddress(address);

  const totals = useMemo(() => {
    const operatorLoss = events.reduce((sum, e) => sum + e.amount, 0);
    const nominatorLoss = (slashes.data?.nominatorTotals ?? []).reduce((s, t) => s + t.amount, 0);
    const nominators = (slashes.data?.nominatorTotals ?? []).reduce((s, t) => s + t.count, 0);
    return {
      operatorLoss,
      nominatorLoss,
      nominators,
      operators: new Set(events.map((e) => e.address)).size,
      worst: events.reduce<SlashEvent | null>(
        (worst, e) => (worst == null || e.fraction > worst.fraction ? e : worst),
        null,
      ),
    };
  }, [events, slashes.data]);

  if (slashes.isError) {
    return (
      <ErrorState
        title="Could not load offence history"
        message="The slashing record did not respond. This is usually temporary."
        onRetry={() => void slashes.refetch()}
      />
    );
  }

  const percent = (v: number) => formatPercent(v, { decimals: 2 });

  return (
    <>
      <ReportedOffences />

      <section aria-labelledby="record" className="mt-14">
        <h2 id="record" className="m-0 text-[22px] leading-7 font-semibold tracking-tight">
          What those offences cost
        </h2>
        <p className="mt-2 mb-0 max-w-[68ch]" style={{ color: 'var(--text-secondary)' }}>
          What was actually taken, read from the chain&rsquo;s own slash records rather than from
          the reports above.
        </p>
        <CoverageNote />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Slashes on record"
            value={formatNumber(events.length)}
            hint={
              totals.operators > 0
                ? `across ${formatNumber(totals.operators)} operator${totals.operators === 1 ? '' : 's'}`
                : 'no operator in our window has been slashed'
            }
            loading={slashes.isLoading}
          />
          <StatTile
            label="Largest single penalty"
            value={totals.worst ? percent(totals.worst.fraction) : '—'}
            hint={
              totals.worst ? `${nameOf(totals.worst.address)}, era ${totals.worst.era}` : undefined
            }
            loading={slashes.isLoading}
          />
          <StatTile
            label="Lost by operators"
            value={formatPolyx(totals.operatorLoss, { compact: true })}
            hint="their own stake only"
            loading={slashes.isLoading}
          />
          {/* When nominator slashing is switched off, a "Lost by nominators: 0"
              tile is noise dressed as data. Say why it is zero instead. */}
          {slashes.data?.scope === 'Validator' ? (
            <StatTile
              label="Lost by nominators"
              value="None"
              hint="nominated tokens are not slashed on Polymesh"
              loading={slashes.isLoading}
            />
          ) : (
            <StatTile
              label="Lost by nominators"
              value={formatPolyx(totals.nominatorLoss, { compact: true })}
              hint={
                totals.nominators > 0
                  ? `${formatNumber(totals.nominators)} nomination${totals.nominators === 1 ? '' : 's'} affected`
                  : undefined
              }
              loading={slashes.isLoading}
            />
          )}
        </div>

        <div className="mt-6">
          {slashes.isLoading ? (
            <Skeleton height={220} label="Loading offences" />
          ) : events.length === 0 ? (
            <EmptyState
              title="Nothing has been slashed in the recorded window"
              message="No operator has lost stake in the eras we hold. That is not the same as no offence having occurred — the reports above show otherwise — it is what happens when a network switches slashing off. See the coverage note for how far back this applies."
            />
          ) : (
            <OffenceTable events={events} nameOf={nameOf} />
          )}
        </div>
      </section>

      <section aria-labelledby="model" className="mt-14">
        <h2 id="model" className="m-0 text-[22px] leading-7 font-semibold tracking-tight">
          What a penalty would cost
        </h2>
        <p className="mt-2 mb-0 max-w-[68ch]" style={{ color: 'var(--text-secondary)' }}>
          Neither penalty depends on how badly one operator behaved. Both depend on{' '}
          <strong>how many operators fail at the same time</strong> — the protocol treats a
          correlated failure as far more dangerous than an isolated one, and prices it that way. The
          curves below are computed from the current active set of{' '}
          {validatorCount > 0 ? formatNumber(validatorCount) : '…'} operators.
        </p>

        <ul
          className="mt-4 mb-0 grid list-none gap-3 p-0 sm:grid-cols-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          <li
            className="rounded-[var(--radius-md)] border p-4 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>Unresponsiveness</strong> — a node that
            stops producing heartbeats. Capped at 7%, and{' '}
            {allowance == null ? (
              <>never charged at the current set size.</>
            ) : (
              <>
                free until <strong>{formatNumber(allowance)}</strong> operators are offline at once.
                A single operator rebooting is not slashed at all; it simply earns nothing that era.
              </>
            )}
          </li>
          <li
            className="rounded-[var(--radius-md)] border p-4 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>Equivocation</strong> — signing two
            conflicting blocks or votes, usually a duplicated key. Quadratic, with no free
            allowance: one operator costs {percent(curves.equivocation[1] ?? 0)}, but a third of the
            set doing it together costs everything.
          </li>
        </ul>

        <div className="mt-4">
          <LazyChart height={320} label="Penalty curves">
            <LazyXyLineChart
              title="Penalty by number of simultaneous offenders"
              subtitle="Both curves are the protocol's formulas, not observed data. Read them as risk, not history."
              x={curves.offenders}
              series={[
                {
                  id: 'unresponsiveness',
                  label: 'Unresponsiveness',
                  values: curves.unresponsiveness,
                },
                { id: 'equivocation', label: 'Equivocation', values: curves.equivocation },
              ]}
              xLabel="Operators offending in the same session"
              yLabel="share of stake slashed"
              format={percent}
              tickFormat={(v) => formatPercent(v, { decimals: 0 })}
              height={320}
              loading={latest.isLoading}
            />
          </LazyChart>
        </div>

        <WhoIsAtRisk scope={slashes.data?.scope ?? null} />
      </section>
    </>
  );

  /**
   * How far back the record reaches, and where it stops being trustworthy.
   *
   * Not a footnote. Slash storage is pruned with the rest of an era's staking
   * state, so an empty table means "no offences we can see", and the difference
   * between that and "no offences" is the whole credibility of the page.
   */
  function CoverageNote() {
    if (!slashes.data) return null;
    const { firstEra, lastEra, prunedBefore } = slashes.data;
    const carried = prunedBefore != null && firstEra < prunedBefore;

    return (
      <p className="mt-2 mb-0 max-w-[68ch] text-sm" style={{ color: 'var(--text-secondary)' }}>
        Covering eras {formatNumber(firstEra)}–{formatNumber(lastEra)}
        {manifest.data ? ` of ${formatNumber(manifest.data.activeEra)} so far` : ''}.{' '}
        {prunedBefore == null ? (
          'The chain still holds the whole of this window.'
        ) : (
          <>
            The chain only retains offence records from era {formatNumber(prunedBefore)} onward;{' '}
            {carried ? (
              <>
                earlier entries here were captured by this site before they were pruned, so the
                record before that era is what we happened to observe rather than a complete one.
              </>
            ) : (
              <>we hold nothing from before it, so earlier offences would not appear here.</>
            )}
          </>
        )}
      </p>
    );
  }
}

/**
 * Offences the chain *reported*, as opposed to slashes it charged for.
 *
 * These are two different records and the difference is the point of this
 * section. The table above is built from `validatorSlashInEra` — what was
 * actually taken — and on Polymesh that is empty, because slashing is switched
 * off. Read alone it says nothing has ever gone wrong, which is not true: the
 * chain has reported 36 incidents against 21 operators, every one of them free.
 *
 * So this is the record of conduct, and the section above is the record of
 * cost. Presenting only the second would flatter every operator that has ever
 * been offline.
 */
function ReportedOffences() {
  const offences = useOffences();
  const registry = useOperators();
  const nameOf = (address: string) => registry.data?.[address]?.name ?? truncateAddress(address);

  const reports = useMemo(() => offences.data?.reports ?? [], [offences.data]);
  const operators = useMemo(() => new Set(reports.map((r) => r.address)).size, [reports]);
  const charged = useMemo(() => reports.filter((r) => r.fraction > 0).length, [reports]);

  // An error here must not take the page down: the section above is the one a
  // nominator came for, and this file is a separate fetch.
  if (offences.isError) return null;

  return (
    <section aria-labelledby="reported" className="mt-14">
      <h2 id="reported" className="m-0 text-[22px] leading-7 font-semibold tracking-tight">
        Offences reported
      </h2>
      <p className="mt-2 mb-0 max-w-[68ch]" style={{ color: 'var(--text-secondary)' }}>
        An offence is reported whether or not it costs anything. These are every report the chain
        has made against a validator, over its whole history — almost always a node that stopped
        responding. They are the record of <em>conduct</em>; the section above is the record of{' '}
        <em>cost</em>, and on this network the two look very different.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          emphasis
          label="Incidents reported"
          value={formatNumber(reports.length)}
          hint={
            operators > 0
              ? `across ${formatNumber(operators)} operator${operators === 1 ? '' : 's'}`
              : 'none in the chain’s history'
          }
          loading={offences.isLoading}
        />
        <StatTile
          label="That cost anything"
          value={formatNumber(charged)}
          hint={
            charged === 0 ? 'every report carried a zero penalty' : 'a penalty was actually applied'
          }
          loading={offences.isLoading}
        />
        <StatTile
          label="Most recent"
          value={
            offences.data?.lastEra == null ? '—' : `Era ${formatNumber(offences.data.lastEra)}`
          }
          hint={reports[0] ? nameOf(reports[0].address) : undefined}
          loading={offences.isLoading}
        />
      </div>

      <div className="mt-6">
        {offences.isLoading ? (
          <Skeleton height={220} label="Loading reported offences" />
        ) : reports.length === 0 ? (
          <EmptyState
            title="No offence has ever been reported"
            message="No validator has been reported for an offence in the chain’s history."
          />
        ) : (
          <ReportTable reports={reports} nameOf={nameOf} />
        )}
      </div>
    </section>
  );
}

/**
 * The reported-offence table.
 *
 * **Reports, not incidents, in the count column.** One offence is re-reported
 * each session until the era ends, so a node down for a day produces up to six
 * events. They are grouped into one row per operator and era by the pipeline;
 * the column says how many reports that row stands for, which is a rough
 * measure of how long the outage lasted.
 *
 * No offence-kind column, for the same reason the table above has none: the
 * event carries validator, fraction and era, and nothing that separates
 * unresponsiveness from equivocation.
 */
function ReportTable({
  reports,
  nameOf,
}: {
  reports: readonly OffenceReport[];
  nameOf: (address: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <caption className="pb-2 text-left" style={{ color: 'var(--text-muted)' }}>
          Every offence reported against a validator, most recent first.
        </caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th scope="col" className="p-2 text-left font-medium">
              Era
            </th>
            <th scope="col" className="p-2 text-left font-medium">
              Operator
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Reports
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Penalty
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr
              key={`${report.era}:${report.address}`}
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <td className="p-2">{formatNumber(report.era)}</td>
              {/* Name *and* address. Most Polymesh operators run three nodes
                  under one identity and the registry deliberately does not
                  number them, so era 1368 shows "Saxon Advisors" three times —
                  three separate nodes that read as a duplicated row without
                  the stash beside them. */}
              <th scope="row" className="p-2 text-left font-normal">
                <Link href={`/operators/${report.address}/`}>{nameOf(report.address)}</Link>{' '}
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {truncateAddress(report.address)}
                </span>
              </th>
              <td className="p-2 text-right">{formatNumber(report.count)}</td>
              <td className="p-2 text-right">
                {report.fraction > 0 ? formatPercent(report.fraction, { decimals: 3 }) : 'None'}
              </td>
              <td className="p-2 text-right">
                <a
                  href={explorerBlockUrl(report.block)}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Block {formatNumber(report.block)} ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Who a slash actually costs.
 *
 * **Read from the chain, never assumed.** Substrate slashes nominators
 * alongside the validator they backed, and this page originally said so —
 * which is wrong for Polymesh, where `validators.slashingAllowedFor` gates it
 * and mainnet is set to `Validator`. Telling nominators their stake is at risk
 * when it is not is a serious thing to get wrong on a page about money, and
 * the reverse would be worse.
 *
 * So the copy follows the switch, and says plainly that it is
 * governance-changeable — the official docs' own phrasing is "not currently
 * subject to slashing, but that could change in the future".
 */
function WhoIsAtRisk({ scope }: { scope: SlashingScope | null }) {
  const shared = (
    <>
      {' '}
      Spreading a nomination across operators run by different people, in different places, reduces
      the chance of being caught in a correlated failure; spreading it across several nodes run by
      the same operator does not. <Link href="/operators/">Compare operators</Link>.
    </>
  );

  return (
    <p className="mt-4 mb-0 max-w-[68ch] text-sm" style={{ color: 'var(--text-muted)' }}>
      {scope === 'Validator' ? (
        <>
          <strong style={{ color: 'var(--text-primary)' }}>
            On Polymesh, only an operator&rsquo;s own stake is slashed.
          </strong>{' '}
          Nominated tokens are not currently at risk — the network sets slashing to apply to
          validators alone. That is a runtime setting rather than a property of the protocol, and
          governance can change it, so it is read from the chain each time this page is generated
          rather than assumed. If it ever changes, the figures above change with it.
        </>
      ) : scope === 'ValidatorAndNominator' ? (
        <>
          <strong style={{ color: 'var(--text-primary)' }}>
            Nominated tokens are at risk alongside the operator&rsquo;s own.
          </strong>{' '}
          A slash is proportional to exposure, so a nominator loses the same percentage as the
          operator they backed — it is not diluted across that operator&rsquo;s other nominators.
        </>
      ) : scope === 'None' ? (
        <>
          <strong style={{ color: 'var(--text-primary)' }}>Slashing is currently disabled.</strong>{' '}
          No stake is at risk from an offence while the network is configured this way. This is a
          runtime setting and governance can change it.
        </>
      ) : (
        <>
          We could not read the network&rsquo;s slashing setting, so we cannot say whether nominated
          tokens are at risk. Treat the curves above as the protocol&rsquo;s maximum rather than as
          what you would actually lose.
        </>
      )}
      {shared}
    </p>
  );
}

/**
 * The offence table.
 *
 * No "type" column, deliberately. `validatorSlashInEra` records the fraction
 * and the amount but not which offence caused them, and guessing from the
 * fraction — 7% looks like unresponsiveness — would be a plausible-looking
 * wrong label on a page about misconduct. The indexer can supply the real type
 * later; until then the column does not exist.
 */
function OffenceTable({
  events,
  nameOf,
}: {
  events: readonly SlashEvent[];
  nameOf: (address: string) => string;
}) {
  // Most recent first: a slash from two days ago matters more than one from
  // three months ago, and the pipeline stores them ascending.
  const rows = [...events].sort((a, b) => b.era - a.era);

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <caption className="pb-2 text-left" style={{ color: 'var(--text-muted)' }}>
          Every offence in the recorded window, most recent first.
        </caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th scope="col" className="p-2 text-left font-medium">
              Era
            </th>
            <th scope="col" className="p-2 text-left font-medium">
              Operator
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Share slashed
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Operator&rsquo;s loss
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => (
            <tr
              key={`${event.era}:${event.address}`}
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <td className="p-2">{formatNumber(event.era)}</td>
              <th scope="row" className="p-2 text-left font-normal">
                <Link href={`/operators/${event.address}/`}>{nameOf(event.address)}</Link>
              </th>
              <td className="p-2 text-right">{formatPercent(event.fraction, { decimals: 3 })}</td>
              <td className="p-2 text-right">{formatPolyx(event.amount, { compact: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
