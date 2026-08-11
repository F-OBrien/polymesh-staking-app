'use client';

import { useMemo } from 'react';
import { useLatest } from '@/lib/data/queries';
import { formatNumber, formatPercent } from '@/lib/format';

/**
 * What the field charges, and what a point of it is worth.
 *
 * Proposed as "a commission histogram", and built as a tally instead once the
 * data was looked at: mainnet has four distinct commissions — 7%, 8%, 9% and
 * 10% — with 68 of 86 operators at exactly 10%. Binning four values into a
 * histogram would draw four bars and imply a continuum that does not exist.
 *
 * It earns its place because commission is the larger of the two levers a
 * nominator has. Measured, block production separates operators by about 1.1%
 * in relative terms once slot luck is removed
 * (`lib/metrics/production.ts`), while the commission spread is 3 percentage
 * points of a ~22% gross return — roughly 0.66 points of APR, an order of
 * magnitude more. The `/operators` table has a commission column and sorts on
 * it; what it cannot say is whether 10% is normal, cheap or dear. This can.
 *
 * Tier 2 throughout: `latest.json` is already loaded for the page.
 */

export function CommissionSpread() {
  const latest = useLatest();

  const summary = useMemo(() => {
    const operators = latest.data?.operators.filter((o) => o.elected) ?? [];
    if (operators.length === 0) return null;

    const tally = new Map<number, number>();
    for (const operator of operators) {
      tally.set(operator.commission, (tally.get(operator.commission) ?? 0) + 1);
    }

    const rows = [...tally.entries()]
      .map(([commission, count]) => ({ commission, count }))
      .sort((a, b) => a.commission - b.commission);

    // The mode, not the mean: with 68 of 86 identical, "what most operators
    // charge" is the fact, and a mean of 9.63% is a number no operator charges.
    const mode = rows.reduce((best, row) => (row.count > best.count ? row : best), rows[0]!);
    const cheapest = rows[0]!;

    // Gross, because commission is taken from the gross return. `impliedApr` is
    // already net of the average fee, so using it would understate the value of
    // a point by about a tenth.
    const ratio = latest.data?.stakingRatio ?? 0;
    const grossApr = ratio > 0 ? (latest.data?.inflation ?? 0) / ratio : 0;

    return {
      rows,
      mode,
      cheapest,
      total: operators.length,
      below: operators.filter((o) => o.commission < mode.commission).length,
      // What one percentage point of commission costs a nominator, in APR.
      pointWorth: grossApr * 0.01,
    };
  }, [latest.data]);

  if (!summary) return null;

  const { rows, mode, cheapest, total, below, pointWorth } = summary;

  return (
    <section
      aria-labelledby="commission-spread"
      className="mt-6 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <h3 id="commission-spread" className="m-0 mb-1 text-[15px] font-semibold">
        What operators charge
      </h3>
      <p className="m-0 mb-3 max-w-[75ch] text-sm" style={{ color: 'var(--text-secondary)' }}>
        {formatNumber(mode.count)} of {formatNumber(total)} charge{' '}
        {formatPercent(mode.commission, { decimals: 0 })}.{' '}
        {below > 0
          ? `${formatNumber(below)} charge less, the cheapest at ${formatPercent(cheapest.commission, { decimals: 0 })}. ` +
            `Each percentage point is worth about ${formatPercent(pointWorth, { decimals: 2 })} of ` +
            `return a year — which is more than block production separates the field by.`
          : 'Every operator charges the same, so commission cannot distinguish them.'}
      </p>

      {/* A tally, not a histogram: four discrete values with no continuum
          between them. One row per value, width by share, so the shape is
          legible without an axis. */}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((row) => {
          const share = row.count / total;
          return (
            <li key={row.commission} className="flex items-center gap-2 text-sm">
              <span
                className="w-12 shrink-0 text-right"
                style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}
              >
                {formatPercent(row.commission, { decimals: 0 })}
              </span>
              <span
                aria-hidden="true"
                className="h-3 rounded-[2px]"
                style={{
                  // Minimum width so a single operator is still a visible mark
                  // rather than a hairline that reads as nothing.
                  width: `max(4px, ${(share * 100).toFixed(1)}%)`,
                  background:
                    row.commission === mode.commission ? 'var(--series-other)' : 'var(--series-2)',
                }}
              />
              <span className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                {formatNumber(row.count)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
