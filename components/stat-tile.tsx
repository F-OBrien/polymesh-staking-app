import type { ReactNode } from 'react';
import { Skeleton } from './states';

/**
 * A single headline figure.
 *
 * The previous app showed numbers with no context at all — "APR 12.4%", up or
 * down, good or bad, versus what? A tile therefore carries an optional delta
 * and hint, and Phase 3 adds a sparkline slot. A bare number is the exception,
 * not the default.
 *
 * Values use proportional figures (large standalone numbers read better that
 * way); `tabular-nums` is reserved for columns that must align vertically.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  footer,
  loading = false,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  // `| undefined` is explicit throughout: under exactOptionalPropertyTypes an
  // optional property is not the same as one that accepts undefined, and these
  // are routinely fed values that are absent while data loads.
  /** Short clarifier under the value, e.g. "of total supply". */
  hint?: string | undefined;
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; label?: string } | undefined;
  /** Freshness stamp or similar. */
  footer?: ReactNode | undefined;
  loading?: boolean | undefined;
  emphasis?: boolean | undefined;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[var(--radius-md)] border p-4"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-1)',
      }}
    >
      <p
        className="m-0 text-xs font-medium tracking-[0.01em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </p>

      {loading ? (
        <Skeleton height={emphasis ? 44 : 32} label={`Loading ${label}`} />
      ) : (
        <p
          className="m-0 font-semibold tracking-tight"
          style={{ fontSize: emphasis ? '2.5rem' : '1.5rem', lineHeight: 1.1 }}
        >
          {value}
        </p>
      )}

      {hint ? (
        <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {hint}
        </p>
      ) : null}

      {delta ? <Delta {...delta} /> : null}
      {footer ? <div className="mt-1">{footer}</div> : null}
    </div>
  );
}

/**
 * A change indicator.
 *
 * Direction is carried by an arrow glyph and a text label as well as colour —
 * never colour alone. Note the colours here are the status palette, which is
 * deliberately reserved and never reused as a series colour.
 */
function Delta({
  value,
  direction,
  label,
}: {
  value: string;
  direction: 'up' | 'down' | 'flat';
  label?: string;
}) {
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const colour =
    direction === 'flat'
      ? 'var(--text-muted)'
      : direction === 'up'
        ? 'var(--status-good)'
        : 'var(--status-critical)';

  return (
    <p className="m-0 flex items-baseline gap-1.5 text-sm">
      <span style={{ color: colour }}>
        <span aria-hidden="true">{arrow}</span> {value}
      </span>
      {label ? <span style={{ color: 'var(--text-muted)' }}>{label}</span> : null}
      {/* Spelled out for assistive tech, which cannot infer meaning from an arrow. */}
      <span className="sr-only">
        {direction === 'up' ? 'increase' : direction === 'down' ? 'decrease' : 'no change'}
      </span>
    </p>
  );
}
