'use client';

import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';
import { useCallback, useEffect, useMemo } from 'react';
// From `lib/charts/palette`, not `banded-line-chart`: importing the cap from
// the chart itself put d3 on the critical path of every page that can pin.
import { MAX_NAMED_SERIES } from '@/lib/charts/palette';
import { readStoredSelection, storeSelection } from './selection-store';

/**
 * Pinned operators.
 *
 * The selection is global: pin an operator on `/operators` and it stays pinned
 * on `/network` and `/compare`, in the same colour. That only works because
 * colour follows the operator's identity rather than its position in the list —
 * the previous app assigned hues by array index, so any filter change repainted
 * every survivor.
 *
 * Two layers, and both are needed:
 *
 *  - **The URL** (`?ops=addr1,addr2`) is authoritative, so a comparison can be
 *    sent to someone and arrive exactly as it left.
 *  - **`localStorage`** ({@link readStoredSelection}) fills in when the URL is
 *    silent. Without it the "global" claim was simply untrue — `<Link>` drops
 *    the query string, so every nav click cleared the selection.
 */

const PARAM = 'ops';

export function useSelectedOperators() {
  const [raw, setRaw] = useQueryState(
    PARAM,
    parseAsArrayOf(parseAsString, ',').withOptions({
      // Pinning is refinement within a view, not a new destination — Back
      // should leave the page, not step through every pin the reader tried.
      history: 'replace',
      shallow: true,
    }),
  );

  /**
   * Keep the two layers in step.
   *
   * A URL selection is copied to storage so it survives the next nav click; an
   * absent one is restored from storage and written back into the URL, which
   * keeps the address bar honest about what is on screen.
   *
   * Restoring only fires for a *non-empty* stored value, so clearing pins stays
   * cleared: `clear()` writes `[]`, which is distinct from never having pinned.
   */
  useEffect(() => {
    if (raw != null) {
      storeSelection(raw);
      return;
    }
    const stored = readStoredSelection();
    if (stored != null && stored.length > 0) void setRaw(stored);
  }, [raw, setRaw]);

  const selected = useMemo(() => raw ?? [], [raw]);

  const setSelected = useCallback(
    (next: readonly string[]) => {
      // Persist *before* touching the URL. Clearing removes the param, and the
      // sync effect above would then read a stale stored value and restore
      // exactly what was just cleared. Writing `[]` first makes the clear stick.
      storeSelection(next);
      // Empty clears the param entirely rather than leaving `?ops=`.
      void setRaw(next.length > 0 ? [...next] : null);
    },
    [setRaw],
  );

  const toggle = useCallback(
    (address: string) => {
      const current = raw ?? [];
      if (current.includes(address)) {
        setSelected(current.filter((a) => a !== address));
        return;
      }
      // Capped at the palette size. Silently dropping the ninth pin would look
      // broken, so the caller surfaces `isFull` and the UI says why.
      if (current.length >= MAX_NAMED_SERIES) return;
      setSelected([...current, address]);
    },
    [raw, setSelected],
  );

  const clear = useCallback(() => setSelected([]), [setSelected]);

  return {
    selected,
    /** Set membership, for row rendering — O(1) rather than O(n) per row. */
    selectedSet: useMemo(() => new Set(selected), [selected]),
    toggle,
    setSelected,
    clear,
    isFull: selected.length >= MAX_NAMED_SERIES,
    max: MAX_NAMED_SERIES,
  };
}
