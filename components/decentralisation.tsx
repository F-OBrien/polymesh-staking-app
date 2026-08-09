'use client';

import { useMemo } from 'react';
import {
  giniCoefficient,
  herfindahlIndex,
  lorenzCurve,
  nakamotoCoefficient,
  topNShare,
} from '@/lib/metrics/stats';
import { formatNumber, formatPercent } from '@/lib/format';
import { StatTile } from '@/components/stat-tile';
import { AsOf } from '@/components/states';
import type { Latest } from '@/lib/schemas/data';

/**
 * How concentrated is the stake?
 *
 * Absent from the previous app entirely, and the question most worth asking of
 * a permissioned chain: the security argument for staking rests on no small
 * group being able to act together, and nothing on the old site said whether
 * that held.
 *
 * Four measures rather than one, because each hides something the others show.
 * Nakamoto responds only to the largest holders; HHI and Gini respond to the
 * whole distribution; the Lorenz curve shows the shape that all three compress
 * into a single number.
 */
export function Decentralisation({
  latest,
  loading,
}: {
  latest: Latest | undefined;
  loading: boolean;
}) {
  const stakes = useMemo(
    () =>
      (latest?.operators ?? [])
        .filter((op) => op.elected)
        .map((op) => Number(BigInt(op.totalStake) / 1_000_000n)),
    [latest],
  );

  const metrics = useMemo(
    () => ({
      nakamoto: nakamotoCoefficient(stakes),
      hhi: herfindahlIndex(stakes),
      gini: giniCoefficient(stakes),
      top10: topNShare(stakes, 10),
      curve: lorenzCurve(stakes),
    }),
    [stakes],
  );

  const asOf = latest ? <AsOf label="the latest snapshot" /> : null;

  return (
    <section aria-labelledby="decentralisation-heading" className="mt-12">
      <h2
        id="decentralisation-heading"
        className="mb-1 text-[22px] leading-7 font-semibold tracking-tight"
      >
        Decentralisation
      </h2>
      <p className="mt-0 mb-4 max-w-[65ch]" style={{ color: 'var(--text-secondary)' }}>
        How evenly stake is spread across the operators elected this era. Concentration is the thing
        that would let a small group act together, so it is worth watching even when returns look
        healthy.
      </p>
      {/* Without this, the figures read as broken rather than as a finding.
          Polymesh's election redistributes nominations to equalise backing, so
          in practice every elected operator ends up with almost the same total
          — measured on mainnet: own stake spans 50K to 5.3M POLYX, while total
          backing spans only 6.34M to 6.57M. That produces a Gini near zero and
          a Lorenz curve sitting on the diagonal, which looks like a bug until
          you know it is the mechanism working. */}
      <p className="mt-0 mb-4 max-w-[65ch] text-sm" style={{ color: 'var(--text-muted)' }}>
        Expect these to look almost perfectly even. The election redistributes nominations to
        equalise how much stake backs each elected operator, so the spread below reflects that
        levelling rather than how much each operator or its nominators actually hold.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Nakamoto coefficient"
          value={loading ? '—' : formatNumber(metrics.nakamoto)}
          hint="operators needed to exceed one third of stake"
          footer={asOf}
          loading={loading}
        />
        <StatTile
          label="Top 10 share"
          value={loading ? '—' : formatPercent(metrics.top10, { decimals: 1 })}
          hint="of all staked POLYX"
          footer={asOf}
          loading={loading}
        />
        <StatTile
          label="Gini coefficient"
          value={loading ? '—' : metrics.gini.toFixed(3)}
          hint="0 is perfectly even, 1 is one operator"
          footer={asOf}
          loading={loading}
        />
        <StatTile
          label="Concentration (HHI)"
          value={loading ? '—' : metrics.hhi.toFixed(3)}
          hint="responds to every share, not just the largest"
          footer={asOf}
          loading={loading}
        />
      </div>

      <div className="mt-4">
        <LorenzChart points={metrics.curve} loading={loading} />
      </div>
    </section>
  );
}

/**
 * The Lorenz curve: cumulative share of operators against cumulative share of
 * stake.
 *
 * Deliberately not built on the era-series chart kit — the x axis is a
 * population share, not time, and forcing it through a time-series component
 * would be worse for both. It is small enough to draw directly.
 *
 * The gap between the curve and the diagonal *is* the inequality, which makes
 * this the one decentralisation view that needs no statistical literacy to
 * read.
 */
function LorenzChart({
  points,
  loading,
}: {
  points: readonly { x: number; y: number }[];
  loading: boolean;
}) {
  const size = 260;
  const pad = 28;
  const inner = size - pad * 2;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad + p.x * inner} ${size - pad - p.y * inner}`)
    .join(' ');

  return (
    <figure
      className="m-0 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <figcaption>
        <h3 className="m-0 text-[17px] leading-6 font-semibold tracking-tight">
          Stake distribution
        </h3>
        <p className="mt-0.5 mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          The further the curve bends below the diagonal, the more concentrated the stake.
        </p>
      </figcaption>

      {loading || points.length < 2 ? (
        <div style={{ height: size }} />
      ) : (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Lorenz curve of stake distribution across ${points.length - 1} operators. The curve bends below the line of perfect equality; the gap between them is the inequality.`}
        >
          {/* Perfect equality, for comparison. */}
          <line
            x1={pad}
            y1={size - pad}
            x2={size - pad}
            y2={pad}
            stroke="var(--axis)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            aria-hidden="true"
          />
          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} aria-hidden="true" />

          <line
            x1={pad}
            y1={size - pad}
            x2={size - pad}
            y2={size - pad}
            stroke="var(--axis)"
            aria-hidden="true"
          />
          <line
            x1={pad}
            y1={pad}
            x2={pad}
            y2={size - pad}
            stroke="var(--axis)"
            aria-hidden="true"
          />

          <text
            x={size / 2}
            y={size - 6}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-muted)"
          >
            operators, smallest first
          </text>
          <text
            transform={`translate(10, ${size / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-muted)"
          >
            share of stake
          </text>
        </svg>
      )}
    </figure>
  );
}
