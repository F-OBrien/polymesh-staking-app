'use client';

import type { UseLiveResult } from '@/lib/data/use-live';

/**
 * The tier-4 Live switch.
 *
 * The honesty rule in §6.6a is the reason this exists as a visible control
 * rather than something the app decides: a reader must never have to guess
 * whether a number is current. Tier-2 values carry "as of HH:MM", tier-3 values
 * tick, and tier-4 values get the dot below. The previous app mixed live
 * subscriptions and cached queries with no visible distinction at all.
 *
 * The dot lights on the first value received, not when the socket opens —
 * "connected but nothing has arrived" is indistinguishable from stale to
 * anyone reading the page, so it should not look live yet.
 */
export function LiveToggle({ live, className = '' }: { live: UseLiveResult; className?: string }) {
  const { enabled, setEnabled, connected, error } = live;

  const status = error
    ? 'Live connection failed'
    : enabled && connected
      ? 'Live — updating as blocks arrive'
      : enabled
        ? 'Connecting…'
        : 'Live updates are off; figures come from a periodic snapshot';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
          style={{
            background: enabled ? 'var(--status-good)' : 'var(--axis)',
          }}
        >
          <span
            className="inline-block size-4 rounded-full transition-transform"
            style={{
              background: 'var(--page-plane)',
              transform: enabled ? 'translateX(18px)' : 'translateX(2px)',
            }}
          />
        </span>
        <span className="flex items-center gap-1.5">
          Live
          {/* Status is carried by the dot *and* the text below, never colour
              alone — and the text is what assistive tech reads. */}
          {enabled ? (
            <span
              aria-hidden="true"
              className={`inline-block size-2 rounded-full ${connected ? 'animate-pulse' : ''}`}
              style={{
                background: error
                  ? 'var(--status-critical)'
                  : connected
                    ? 'var(--status-good)'
                    : 'var(--text-muted)',
              }}
            />
          ) : null}
        </span>
      </label>

      <span role="status" className="sr-only">
        {status}
      </span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }} aria-hidden="true">
        {error
          ? 'connection failed'
          : enabled && connected
            ? 'updating'
            : enabled
              ? 'connecting…'
              : null}
      </span>
    </div>
  );
}
