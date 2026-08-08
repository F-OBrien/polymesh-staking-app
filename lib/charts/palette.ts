/**
 * The categorical series palette.
 *
 * Lives in its own module, with no imports, for two reasons.
 *
 * *Correctness:* it was duplicated verbatim in `banded-line-chart` and
 * `legend`, so a palette change had to be made twice or the swatches would
 * stop matching the lines they label.
 *
 * *Weight:* `useSelectedOperators` needs the cap and nothing else, and importing
 * it from `banded-line-chart` pulled that module — and so d3-scale and d3-shape
 * — onto the critical path of every page that can pin an operator. That
 * measured 17.1 KB gzip on `/operators`, pushing the route 20 KB past its
 * budget and defeating the lazy-loading in `lazy-chart`. A constant should not
 * cost a charting library; keeping this file dependency-free is what guarantees
 * it cannot.
 */

/**
 * Fixed palette order, CVD-validated as eight mutually distinguishable hues.
 *
 * Slots are assigned by an operator's stable identity, never by its index in a
 * filtered list, and the list is **never cycled**: a ninth series would repeat
 * a colour already in use, which reads as "these two are the same". Callers cap
 * at `MAX_NAMED_SERIES` and fold the remainder into an unnamed "Other".
 */
export const SERIES_TOKENS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

/** How many series can be named at once — the palette size, by definition. */
export const MAX_NAMED_SERIES = SERIES_TOKENS.length;
