'use client';

import Link from 'next/link';
import { parseAsBoolean, parseAsFloat, parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useId, useMemo } from 'react';
import { useEraSeries, useLatest, useManifest, useOperators } from '@/lib/data/queries';
import { EraRangeControl, useResolvedRange } from '@/components/era-range-control';
import { buildOperatorRows } from '@/lib/data/operator-rows';
import { assumptions, project } from '@/lib/metrics/projection';
import { mean, stdDev } from '@/lib/metrics/stats';
import { ProjectionChart } from '@/components/projection-chart';
import { StatTile } from '@/components/stat-tile';
import { ErrorState } from '@/components/states';
import { OperatorPicker } from '@/components/operator-picker';
import { formatNumber, formatPercent, formatPolyx } from '@/lib/format';

/**
 * Reward projection.
 *
 * Every input is in the URL, so a scenario can be sent to someone — the same
 * principle as `?eras=` and `?ops=`. The previous app had no calculator at all;
 * the only way to answer "what would I earn" was to read an APR off a chart and
 * do the arithmetic yourself, with no sense of how much that APR moved.
 *
 * The design decision that matters here is that the output is a **range**, not
 * a number. A staking calculator that prints one confident figure is
 * misleading: the return depends on the staking ratio, on the operator
 * continuing to perform, and on its commission not changing. The band comes
 * from that operator's own measured variance over the selected range, and the
 * assumptions are listed in words beside it.
 */

/** Horizons offered. Anything longer is a forecast, not a projection. */
const HORIZONS = [
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
  { days: 1095, label: '3 years' },
] as const;

const DEFAULT_AMOUNT = 10_000;
const DEFAULT_DAYS = 365;

/** Sentinel for "the network as a whole" rather than a specific operator. */
const NETWORK = '';

export function CalculatorView() {
  const manifest = useManifest();
  const latest = useLatest();
  const registry = useOperators();
  const range = useResolvedRange(manifest.data);
  const { series, isLoading, isError } = useEraSeries(range);

  const amountId = useId();

  // Shallow + replace throughout: changing an input refines the current view
  // rather than navigating, so Back should leave the page, not undo one keystroke.
  const urlOptions = { history: 'replace', shallow: true } as const;

  const [amount, setAmount] = useQueryState(
    'amount',
    parseAsFloat.withDefault(DEFAULT_AMOUNT).withOptions(urlOptions),
  );
  const [days, setDays] = useQueryState(
    'days',
    parseAsInteger.withDefault(DEFAULT_DAYS).withOptions(urlOptions),
  );
  const [operator, setOperator] = useQueryState(
    'op',
    parseAsString.withDefault(NETWORK).withOptions(urlOptions),
  );
  const [compound, setCompound] = useQueryState(
    'compound',
    parseAsBoolean.withDefault(false).withOptions(urlOptions),
  );

  const erasPerYear = manifest.data?.erasPerYear ?? 365;

  const rows = useMemo(
    () => buildOperatorRows({ series, latest: latest.data, registry: registry.data, erasPerYear }),
    [series, latest.data, registry.data, erasPerYear],
  );

  /**
   * The return being projected from.
   *
   * For a chosen operator, its own mean and standard deviation. For the network
   * option, the mean and deviation of the *stake-weighted network average* over
   * the same eras — not the average of per-operator averages, which would
   * over-weight small operators.
   */
  const basis = useMemo(() => {
    if (operator !== NETWORK) {
      const row = rows.find((r) => r.address === operator);
      if (row) {
        return {
          label: row.name,
          apr: row.aprMedian,
          stdDev: row.aprSpread,
          commission: row.commission,
        };
      }
    }
    const networkApr = series?.network.avgApr ?? [];
    return {
      label: 'the network average',
      apr: mean(networkApr) ?? latest.data?.impliedApr ?? null,
      stdDev: stdDev(networkApr),
      commission: null,
    };
  }, [operator, rows, series, latest.data]);

  const projection = useMemo(
    () =>
      project({
        amount: Number.isFinite(amount) ? amount : 0,
        apr: basis.apr ?? 0,
        aprStdDev: basis.stdDev,
        days,
        erasPerYear,
        compound,
      }),
    [amount, basis, days, erasPerYear, compound],
  );

  const notes = assumptions({
    compound,
    hasVariance: basis.stdDev != null && basis.stdDev > 0,
    operatorLabel: basis.label,
  });

  if (manifest.isError && latest.isError) {
    return (
      <ErrorState
        title="Could not load the data behind this calculator"
        message="Projections come from measured history, so there is nothing honest to show without it."
        onRetry={() => {
          void manifest.refetch();
          void latest.refetch();
        }}
      />
    );
  }

  const hasBand = projection.reward.high - projection.reward.low > 0.005;
  const polyx = (v: number) => formatPolyx(v, { decimals: 0 });

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        <EraRangeControl manifest={manifest.data} />
      </div>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section
          aria-labelledby="inputs"
          className="flex flex-col gap-5 rounded-[var(--radius-md)] border p-5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        >
          <h2 id="inputs" className="m-0 text-[17px] leading-6 font-semibold">
            Your position
          </h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={amountId} className="text-sm font-medium">
              Amount to bond
            </label>
            <div className="flex items-center gap-2">
              <input
                id={amountId}
                type="number"
                inputMode="decimal"
                min={0}
                step={100}
                value={Number.isFinite(amount) ? amount : ''}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  void setAmount(
                    event.target.value === '' || !Number.isFinite(next) ? null : Math.max(0, next),
                  );
                }}
                className="w-full rounded-[var(--radius-sm)] border px-3 py-2"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--page-plane)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <span className="shrink-0 text-sm" style={{ color: 'var(--text-muted)' }}>
                POLYX
              </span>
            </div>
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-sm font-medium">For how long</legend>
            <div className="flex flex-wrap gap-1">
              {HORIZONS.map((horizon) => (
                <label
                  key={horizon.days}
                  className="cursor-pointer rounded-full border px-3 py-1.5 text-sm"
                  style={{
                    borderColor: days === horizon.days ? 'var(--series-1)' : 'var(--border)',
                    color: days === horizon.days ? 'var(--series-1)' : 'var(--text-primary)',
                    fontWeight: days === horizon.days ? 600 : 400,
                  }}
                >
                  <input
                    type="radio"
                    name="horizon"
                    className="sr-only"
                    checked={days === horizon.days}
                    onChange={() =>
                      void setDays(horizon.days === DEFAULT_DAYS ? null : horizon.days)
                    }
                  />
                  {horizon.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Nominating</span>
            {operator === NETWORK ? (
              <>
                <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  The network average, across every operator.
                </p>
                <OperatorPicker
                  rows={rows}
                  selected={new Set()}
                  onSelect={(address) => void setOperator(address)}
                />
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/operators/${operator}/`} className="text-sm">
                  {basis.label}
                </Link>
                <button
                  type="button"
                  onClick={() => void setOperator(null)}
                  className="text-sm underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  use the network average instead
                </button>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={compound}
              onChange={(event) => void setCompound(event.target.checked || null)}
              className="mt-0.5"
            />
            <span>
              Re-bond rewards each era
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                Polymesh does not do this for you — this models claiming and bonding every era.
              </span>
            </span>
          </label>
        </section>

        <section aria-labelledby="result" className="flex flex-col gap-4">
          <h2 id="result" className="sr-only">
            Projection
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              emphasis
              label={`Rewards over ${HORIZONS.find((h) => h.days === days)?.label ?? `${days} days`}`}
              value={projection.apr.mid > 0 ? polyx(projection.reward.mid) : '—'}
              hint={
                hasBand
                  ? `between ${polyx(projection.reward.low)} and ${polyx(projection.reward.high)}`
                  : undefined
              }
              loading={isLoading}
            />
            <StatTile
              label="Total after rewards"
              value={polyx(projection.total.mid)}
              hint={`${formatNumber(projection.eras)} eras of rewards`}
              loading={isLoading}
            />
            <StatTile
              label={compound ? 'Effective annual rate' : 'Annual rate'}
              value={formatPercent(projection.apy.mid, { decimals: 2 })}
              hint={
                basis.commission != null
                  ? `after ${formatPercent(basis.commission, { decimals: 1 })} commission`
                  : 'after commission'
              }
              loading={isLoading}
            />
            {/* Both tiles read from `apy`, which equals `apr` when not
                compounding. Reading the range from `apr` while the tile above
                showed `apy` put the headline rate outside its own range. */}
            <StatTile
              label="Range of outcomes"
              value={
                hasBand
                  ? `${formatPercent(projection.apy.low, { decimals: 1 })} – ${formatPercent(projection.apy.high, { decimals: 1 })}`
                  : formatPercent(projection.apy.mid, { decimals: 2 })
              }
              hint={
                hasBand ? 'one standard deviation of past eras' : 'not enough history to measure'
              }
              loading={isLoading}
            />
          </div>

          {/* C22, redesigned. The spec's "bar with a sensitivity range" would
              restate the tiles above in more space; the accumulation curve
              shows the shape, and the band widening with the horizon is the
              honest statement that a far-out projection is a weaker claim. */}
          <ProjectionChart
            amount={Number.isFinite(amount) ? amount : 0}
            apr={basis.apr ?? 0}
            aprStdDev={basis.stdDev}
            days={days}
            erasPerYear={erasPerYear}
            compound={compound}
            basisLabel={basis.label}
          />

          {isError ? (
            <p className="m-0 text-sm" style={{ color: 'var(--status-critical)' }}>
              Era history did not load, so this is based on the current snapshot alone and carries
              no range.
            </p>
          ) : null}

          <div
            className="rounded-[var(--radius-md)] border p-4"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          >
            <h3 className="m-0 text-[15px] leading-5 font-semibold">What this assumes</h3>
            <ul
              className="mt-2 mb-0 flex list-disc flex-col gap-1.5 pl-5 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <p className="mt-3 mb-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              The formulas behind this are written out on the <Link href="/about/">about page</Link>
              , and the staking-ratio dependency is visible on{' '}
              <Link href="/network/">the network page</Link>.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
