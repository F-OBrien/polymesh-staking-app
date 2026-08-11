'use client';

import { useMemo } from 'react';
import { useEraSeries, useManifest, useOperators } from '@/lib/data/queries';
import { deriveOperatorApr } from '@/lib/metrics/derive';
import { rankOperators } from '@/lib/data/series';
import { formatPercent, formatPolyx } from '@/lib/format';
import { EraSeriesChart } from '@/components/charts/era-series-chart';
import { Sparkline } from '@/components/charts/sparkline';
import { StatTile } from '@/components/stat-tile';
import type { NamedSeries } from '@/components/charts/banded-line-chart';

/**
 * Renders the chart kit against whatever data is present.
 *
 * Uses the real query layer rather than hand-made props, so this doubles as an
 * end-to-end check that the manifest → chunk → stitch → derive path works.
 */
export function KitchenSink() {
  const manifest = useManifest();
  const operatorNames = useOperators();
  const { series, isLoading, isError, error } = useEraSeries();

  const erasPerYear = manifest.data?.erasPerYear ?? 365;

  /**
   * Default selection: the five largest operators by current stake.
   *
   * Phase 5 replaces this with the wallet's nominations when connected, falling
   * back to this. Colour follows the operator's identity, not its rank, so a
   * later filter change must not repaint the survivors.
   */
  const selected = useMemo(() => (series ? rankOperators(series, 'totalStake', 5) : []), [series]);

  const aprSeries = useMemo<NamedSeries[]>(() => {
    if (!series) return [];
    return selected.flatMap((address) => {
      const columns = series.operators[address];
      if (!columns) return [];
      const { net } = deriveOperatorApr(columns, series.network, erasPerYear);
      return [
        {
          id: address,
          label: operatorNames.data?.[address]?.name ?? address,
          values: net,
        },
      ];
    });
  }, [series, selected, operatorNames.data, erasPerYear]);

  const stakeSeries = useMemo<NamedSeries[]>(() => {
    if (!series) return [];
    return selected.flatMap((address) => {
      const columns = series.operators[address];
      if (!columns) return [];
      return [
        {
          id: address,
          label: operatorNames.data?.[address]?.name ?? address,
          values: columns.totalStake,
        },
      ];
    });
  }, [series, selected, operatorNames.data]);

  const band = series
    ? { lo: series.network.aprP10, mid: series.network.aprP50, hi: series.network.aprP90 }
    : undefined;

  const percent = (value: number | null) => formatPercent(value, { decimals: 2 });
  const polyx = (value: number | null) =>
    value == null ? '—' : formatPolyx(value, { compact: true });

  return (
    <div className="mt-10 flex flex-col gap-10">
      <section aria-labelledby="ks-charts">
        <h2 id="ks-charts" className="mb-3 text-[22px] leading-7 font-semibold tracking-tight">
          Banded multi-series
        </h2>
        <div className="flex flex-col gap-4">
          <EraSeriesChart
            title="Operator return, after commission"
            subtitle="How do these operators compare with the field?"
            series={series}
            operators={aprSeries}
            band={band}
            reference={
              series ? { values: series.network.avgApr, label: 'Network average' } : undefined
            }
            format={percent}
            tickFormat={(v) => formatPercent(v, { decimals: 0 })}
            yLabel="APR"
            loading={isLoading}
            error={isError ? ((error as Error | null) ?? new Error('Unknown error')) : null}
          />

          <EraSeriesChart
            title="Stake backing each operator"
            subtitle="Is stake flowing toward or away from these operators?"
            series={series}
            operators={stakeSeries}
            format={polyx}
            tickFormat={(v) => formatPolyx(v, { compact: true })}
            yLabel="POLYX"
            includeZero
            height={260}
            loading={isLoading}
            error={isError ? ((error as Error | null) ?? new Error('Unknown error')) : null}
          />
        </div>
      </section>

      <section aria-labelledby="ks-tiles">
        <h2 id="ks-tiles" className="mb-3 text-[22px] leading-7 font-semibold tracking-tight">
          Stat tiles and sparklines
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            emphasis
            label="Emphasis"
            value={percent(series?.network.avgApr.at(-1) ?? null)}
            hint="hero figure"
          />
          <StatTile
            label="With an upward delta"
            value={percent(series?.network.avgApr.at(-1) ?? null)}
            delta={{ value: '0.42pp', direction: 'up', label: 'vs 30d' }}
          />
          <StatTile
            label="With a downward delta"
            value={polyx(series?.network.totalStaked.at(-1) ?? null)}
            delta={{ value: '1.2%', direction: 'down', label: 'vs 30d' }}
          />
          <StatTile label="Loading" value="—" loading />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6">
          {(
            [
              ['Average APR', series?.network.avgApr, 'var(--series-1)'],
              ['Total staked', series?.network.totalStaked, 'var(--series-2)'],
              ['Total points', series?.network.totalPoints, 'var(--series-4)'],
            ] as const
          ).map(([label, values, colour]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <Sparkline values={values ?? []} colour={colour} />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ks-palette">
        <h2 id="ks-palette" className="mb-3 text-[22px] leading-7 font-semibold tracking-tight">
          Categorical palette
        </h2>
        <p className="mb-3 max-w-[60ch] text-sm" style={{ color: 'var(--text-secondary)' }}>
          Fixed order, never cycled. Slot 1 is the brand pink and is the same hex in both themes.
          Slots 3, 4 and 7 sit under 3:1 on the light surface, which is why every chart ships direct
          labels and a table view.
        </p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((slot) => (
            <div key={slot} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className="inline-block size-6 rounded-[var(--radius-sm)]"
                style={{ background: `var(--series-${slot})`, border: '1px solid var(--border)' }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>slot {slot}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
