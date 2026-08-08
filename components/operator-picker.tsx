'use client';

import dynamic from 'next/dynamic';
import type { OperatorRow } from '@/lib/data/operator-rows';

/**
 * The operator combobox, code-split.
 *
 * `cmdk` costs **13.3 KB gzip**, measured. Statically imported it sat on the
 * critical path of `/compare` and `/calculator` and put both ~19 KB over
 * budget, against roughly 14 KB of headroom over the shared floor.
 *
 * Unlike TanStack Table in Phase 5, the library is kept rather than replaced.
 * The distinction is what it buys: a combobox needs `aria-activedescendant`,
 * a roving active item, type-ahead filtering and correct listbox semantics —
 * fiddly, well-specified work with nothing to do with our visual identity,
 * exactly like Radix Tabs in `chart-frame`. Hand-rolling it would trade 13 KB
 * for a worse experience for keyboard and screen-reader users. Sorting a
 * hundred rows was not that trade.
 *
 * So it loads after first paint instead. The fallback below reserves the same
 * box, so nothing shifts; the real control replaces it within a few hundred
 * milliseconds, well before anyone has read the page and reached for it.
 */

export interface OperatorPickerProps {
  rows: readonly OperatorRow[];
  selected: ReadonlySet<string>;
  onSelect: (address: string) => void;
  disabled?: boolean;
  disabledReason?: string | undefined;
}

export const OperatorPicker = dynamic<OperatorPickerProps>(
  () => import('./operator-picker-impl').then((m) => m.OperatorPickerImpl),
  {
    // Nothing to prerender: the control is measured and interactive by nature,
    // and static export would emit an inert box either way.
    ssr: false,
    loading: () => (
      <div
        className="w-full max-w-sm rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        aria-hidden="true"
      >
        Add an operator…
      </div>
    ),
  },
);
