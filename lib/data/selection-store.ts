/**
 * Durable storage for the pinned-operator selection.
 *
 * The selection itself lives in the URL (`?ops=…`), which is what makes a
 * comparison shareable. But a URL query string is *per page*: the nav links to
 * `/compare` and `/network` carry no query, so pinning three operators in the
 * directory and clicking Compare landed on an empty page. The site said the
 * selection travelled with you and it did not.
 *
 * So the URL stays authoritative — a link someone sends you always wins — and
 * this is the fallback consulted only when the URL says nothing at all.
 *
 * `localStorage` rather than `sessionStorage` because a pinned operator is
 * closer to a watchlist than to a scroll position: someone tracking their own
 * nodes wants them still pinned tomorrow. §4.11 of the design doc lists the
 * absence of any persistence as a gap.
 */

import { MAX_NAMED_SERIES } from '@/lib/charts/palette';

export const SELECTION_STORAGE_KEY = 'pm-staking-ops';

/**
 * An address, loosely. Deliberately not a strict SS58 check: this is a guard
 * against a corrupt or hand-edited storage value reaching the chart layer, not
 * a validator. An address that no longer exists renders as "no data" anyway.
 */
const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{40,60}$/;

/**
 * The stored selection, or null when nothing has ever been stored.
 *
 * The null/empty distinction carries meaning and must survive: `[]` means the
 * reader cleared their pins, and restoring anything over that would make the
 * clear button look broken on the next navigation.
 */
export function readStoredSelection(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((v): v is string => typeof v === 'string' && ADDRESS_PATTERN.test(v))
      .slice(0, MAX_NAMED_SERIES);
  } catch {
    // Unparseable, or localStorage throws in private-browsing and sandboxed
    // frames. Either way the URL is still the source of truth.
    return null;
  }
}

export function storeSelection(addresses: readonly string[]): void {
  try {
    window.localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify(addresses.slice(0, MAX_NAMED_SERIES)),
    );
  } catch {
    // Non-fatal: the selection still works for this page.
  }
}
