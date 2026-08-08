'use client';

import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';
import { useCallback, useMemo } from 'react';
// From `lib/charts/palette`, not `banded-line-chart`: importing the cap from
// the chart itself put d3 on the critical path of every page that can pin.
import { MAX_NAMED_SERIES } from '@/lib/charts/palette';

/**
 * Pinned operators, held in the URL.
 *
 * The selection is global: pin an operator on `/operators` and it stays pinned
 * on `/network` and `/compare`, in the same colour. That only works because
 * colour follows the operator's identity rather than its position in the list —
 * the previous app assigned hues by array index, so any filter change repainted
 * every survivor.
 *
 * In the URL (`?ops=addr1,addr2`) so a comparison can be sent to someone. That
 * is the main way analysis travels, and the previous app could not do it at all.
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

  const selected = useMemo(() => raw ?? [], [raw]);

  const setSelected = useCallback(
    (next: readonly string[]) => {
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
