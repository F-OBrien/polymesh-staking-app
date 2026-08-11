'use client';

import { useEffect, useRef, useState } from 'react';
import { truncateAddress } from '@/lib/format';

/**
 * An address, truncated for reading, copied in full.
 *
 * **The whole point is that the two differ.** Every address on this site is
 * shown as `2DK6iD…P7SaFf` because a 48-character SS58 string is unreadable in
 * a table cell — but a truncation is useless to paste anywhere, and selecting
 * the text by hand copies the ellipsis. So the button always writes the
 * complete address, never what is on screen.
 *
 * Feedback is required rather than nice: a copy that silently succeeds and a
 * copy that silently fails look identical, and the failure mode is real —
 * `navigator.clipboard` is unavailable over plain HTTP and in some embedded
 * browsers. Both outcomes are announced.
 */

type CopyState = 'idle' | 'copied' | 'failed';

/** How long the confirmation stays up. Long enough to read, short enough to go. */
const FEEDBACK_MS = 1600;

export function useCopy(): [CopyState, (text: string) => void] {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A copy on an unmounting row must not set state after it has gone.
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const copy = (text: string) => {
    const settle = (next: CopyState) => {
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), FEEDBACK_MS);
    };

    // Optional chaining rather than a feature test: `navigator.clipboard` is
    // undefined outside a secure context, which includes plain-HTTP previews.
    void navigator.clipboard
      ?.writeText(text)
      .then(() => settle('copied'))
      .catch(() => settle('failed'));

    if (navigator.clipboard == null) settle('failed');
  };

  return [state, copy];
}

export interface CopyAddressProps {
  address: string;
  /** Characters kept at each end of the displayed form. */
  head?: number;
  tail?: number;
  /** What this address belongs to, for the button's accessible name. */
  label?: string;
  /** Renders the address in the monospace face. On by default. */
  mono?: boolean;
  className?: string;
}

export function CopyAddress({
  address,
  head = 6,
  tail = 6,
  label,
  mono = true,
  className = '',
}: CopyAddressProps) {
  const [state, copy] = useCopy();

  const description = label ? `${label}’s address` : 'address';

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        // The full address in the title, so a hover reveals it without a click.
        title={address}
        style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}
      >
        {truncateAddress(address, head, tail)}
      </span>
      <button
        type="button"
        onClick={(event) => {
          // Addresses commonly sit inside a link or a clickable row.
          event.preventDefault();
          event.stopPropagation();
          copy(address);
        }}
        aria-label={
          state === 'copied'
            ? `Copied the full ${description}`
            : state === 'failed'
              ? `Could not copy the ${description}`
              : `Copy the full ${description}`
        }
        title={state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy address'}
        className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded transition-colors"
        style={{
          color:
            state === 'copied'
              ? 'var(--status-good)'
              : state === 'failed'
                ? 'var(--status-critical)'
                : 'var(--text-muted)',
        }}
      >
        <span aria-hidden="true" className="text-xs leading-none">
          {state === 'copied' ? '✓' : state === 'failed' ? '✕' : '⧉'}
        </span>
      </button>
      {/* Announced to assistive tech, which cannot see the icon change. */}
      <span aria-live="polite" className="sr-only">
        {state === 'copied'
          ? `Copied ${address}`
          : state === 'failed'
            ? 'Copying is not available in this browser. The full address is in the tooltip.'
            : ''}
      </span>
    </span>
  );
}
