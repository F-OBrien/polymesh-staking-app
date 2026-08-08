'use client';

import type { ReactNode } from 'react';

/**
 * Loading, empty and error states.
 *
 * These exist as first-class components because the previous app had none: a
 * failed RPC connection left a spinner turning forever, with no message, no
 * retry, and no way to tell a slow network from a dead endpoint. Every data
 * surface in this app must render one of these instead.
 */

/**
 * A skeleton that reserves the *exact* final height.
 *
 * Charts pop in late by nature, and a placeholder that is the wrong size shoves
 * the page around when real content arrives. The CLS budget is zero, which
 * means every skeleton takes the same dimensions as the thing it stands in for.
 */
export function Skeleton({
  height,
  className = '',
  label,
}: {
  height: number | string;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-md)] ${className}`}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        background: 'var(--series-other-alpha)',
      }}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{label ?? 'Loading'}</span>
    </div>
  );
}

/**
 * A recoverable failure.
 *
 * Always names what failed and offers a retry. The distinction that matters to
 * a user is "the site is broken" versus "this one thing did not load" — so this
 * is scoped to the surface that failed rather than replacing the page.
 */
export function ErrorState({
  title = 'Could not load this data',
  message,
  onRetry,
  compact = false,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-start gap-3 rounded-[var(--radius-md)] border ${
        compact ? 'p-4' : 'p-6'
      }`}
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-start gap-2.5">
        {/* Icon plus text: status is never carried by colour alone. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="var(--status-critical)"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="mt-0.5 shrink-0"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5M12 16h.01" />
        </svg>
        <div>
          <p className="m-0 font-semibold">{title}</p>
          {message ? (
            <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {message}
            </p>
          ) : null}
        </div>
      </div>

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * No data to show, which is different from an error.
 *
 * Used where a filter matches nothing, or where an era range extends past the
 * history we hold — a normal situation that must not read as a failure.
 */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed p-8 text-center"
      style={{ borderColor: 'var(--axis)' }}
    >
      <p className="m-0 font-medium">{title}</p>
      {message ? (
        <p className="m-0 max-w-prose text-sm" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
      ) : null}
      {action}
    </div>
  );
}

/**
 * Freshness stamp for snapshot-derived values (design doc §6.6a, tier 2).
 *
 * Every value from `latest.json` is up to 15 minutes old. Showing it without
 * saying so leaves the user to guess whether a number is current — which is
 * exactly the ambiguity the previous app created by mixing live subscriptions
 * and cached queries with no visible distinction.
 */
export function AsOf({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span
      className={`text-xs ${className}`}
      style={{ color: 'var(--text-muted)' }}
      title="This value comes from a periodic snapshot, not a live connection"
    >
      as of {label}
    </span>
  );
}
