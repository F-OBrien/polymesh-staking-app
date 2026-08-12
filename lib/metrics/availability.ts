import { interiorGaps } from '@/lib/charts/geometry';

/**
 * How much of its own history an operator was actually producing for.
 *
 * The charts show *when* an operator dropped out; nothing said *how often*. On
 * a permissioned chain that is the question a nominator is really asking. There
 * is no election to lose here — mainnet runs ~90 validators against 100 slots
 * with nobody waiting, so an operator that is not in the active set is one that
 * was chilled or whose node stopped, not one that was outbid. That makes the
 * absence rate a genuine reliability signal rather than a measure of
 * competition, which is why this is worth stating as a figure.
 *
 * **Measured over the operator's own record, not the selected range.** An
 * operator that joined three eras ago has not "missed" the preceding year, and
 * counting the window from the range's start would report 97% absence for every
 * new operator on the chart. The window therefore runs from the first era the
 * operator has data for to the last — the same interior-only rule the gap marks
 * are drawn from, so the tile and the plot can never disagree.
 *
 * The corollary is that the figure is bounded by the range on screen: at 90
 * eras it describes ninety eras. The caller is handed `fromEra`/`toEra` so it
 * can say which.
 */

export interface AbsenceRun {
  fromEra: number;
  toEra: number;
  /** Inclusive length, in eras. */
  eras: number;
}

export interface Availability {
  /** First era of the operator's own record within the range. */
  fromEra: number;
  toEra: number;
  /** `toEra - fromEra + 1`. */
  window: number;
  /** Eras in the window it was in the active set. */
  inSet: number;
  /** Eras in the window it was absent from the active set. */
  missed: number;
  /**
   * Eras it was in the set and earned nothing.
   *
   * Distinct from `missed` and easy to overlook: an elected validator whose
   * node is down still appears in every column, with zero points. That leaves
   * no gap in the line and no mark on the chart, so without this it is the one
   * kind of outage the page cannot show. Counted separately rather than added
   * to `missed`, because being elected and silent is a different failure from
   * not being elected at all.
   */
  blank: number;
  /** `inSet / window`, in [0,1]. */
  rate: number;
  /** Contiguous absences, longest first. */
  runs: AbsenceRun[];
}

export interface AvailabilityInput {
  /** Era axis, contiguous — see `StitchedSeries.eras`. */
  eras: readonly number[];
  /** The operator's points column: null means "not in the set". */
  points: readonly (number | null)[];
}

export function summariseAvailability({ eras, points }: AvailabilityInput): Availability | null {
  const defined = (i: number) => {
    const value = points[i];
    return value != null && Number.isFinite(value);
  };

  let first = 0;
  while (first < points.length && !defined(first)) first += 1;
  let last = points.length - 1;
  while (last >= 0 && !defined(last)) last -= 1;

  // No record at all in this range. Null rather than a zeroed summary: "0
  // eras missed of 0" reads as a clean sheet, which is the opposite of "we
  // have nothing to say about this operator".
  if (first > last) return null;

  const fromEra = eras[first];
  const toEra = eras[last];
  if (fromEra == null || toEra == null) return null;

  let inSet = 0;
  let blank = 0;
  for (let i = first; i <= last; i += 1) {
    if (!defined(i)) continue;
    inSet += 1;
    if (points[i] === 0) blank += 1;
  }

  const window = last - first + 1;
  const runs = interiorGaps(points)
    .map((run) => ({
      fromEra: eras[run.from] as number,
      toEra: eras[run.to] as number,
      eras: run.to - run.from + 1,
    }))
    .sort((a, b) => b.eras - a.eras || a.fromEra - b.fromEra);

  return {
    fromEra,
    toEra,
    window,
    inSet,
    missed: window - inSet,
    blank,
    rate: window > 0 ? inSet / window : 0,
    runs,
  };
}
