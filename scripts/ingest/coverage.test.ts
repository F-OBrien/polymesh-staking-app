import { describe, expect, it } from 'vitest';
import { analyseCoverage } from './rollup';

/**
 * Regression tests for the incremental cursor.
 *
 * This is the subtlest of the four bugs the first mainnet run exposed, and the
 * most expensive: the manifest recorded the chain's `lastCompleteEra` rather
 * than what had actually been stored, so a bounded run (`--max-eras 6`) left the
 * cursor claiming eras that were never fetched. The next run reported "up to
 * date" having skipped 77 eras — no error, no warning, just a permanent hole in
 * the history.
 *
 * Two properties have to hold, and only the first is obvious:
 *
 *  1. The cursor is what is *stored*, not what the chain reports.
 *  2. It is the **contiguous** span from the oldest era. A min/max span cannot
 *     see an interior gap, so it would report 1663-1746 for a set holding only
 *     1663-1668 and 1746 — stranding everything between, forever.
 */
describe('analyseCoverage', () => {
  it('reports nothing for an empty store', () => {
    expect(analyseCoverage([])).toEqual({ coverage: null, gaps: [] });
  });

  it('reports a single era as a one-era span', () => {
    expect(analyseCoverage([1663])).toEqual({
      coverage: { firstEra: 1663, lastEra: 1663 },
      gaps: [],
    });
  });

  it('reports a fully contiguous run with no gaps', () => {
    const eras = Array.from({ length: 84 }, (_, i) => 1663 + i);
    expect(analyseCoverage(eras)).toEqual({
      coverage: { firstEra: 1663, lastEra: 1746 },
      gaps: [],
    });
  });

  it('stops the cursor at the first gap — the bug that lost 77 eras', () => {
    // Exactly the shape a `--max-eras 6` run left behind: six eras fetched from
    // the bottom of the window, then the trailing era from an earlier run.
    const stored = [1663, 1664, 1665, 1666, 1667, 1668, 1746];

    expect(analyseCoverage(stored)).toEqual({
      coverage: { firstEra: 1663, lastEra: 1668 },
      gaps: [{ from: 1669, to: 1745 }],
    });
  });

  it('does not resume the cursor after a gap, even across a long later run', () => {
    // The guard that makes healing possible: once a gap is seen, contiguity
    // must not advance again. Reporting 1746 here would strand 1669-1745 just
    // as surely as a min/max span would.
    const stored = [1663, 1664, 1740, 1741, 1742, 1743, 1744, 1745, 1746];

    expect(analyseCoverage(stored).coverage).toEqual({ firstEra: 1663, lastEra: 1664 });
  });

  it('records every gap, not just the first', () => {
    const { gaps } = analyseCoverage([10, 11, 15, 16, 20]);
    expect(gaps).toEqual([
      { from: 12, to: 14 },
      { from: 17, to: 19 },
    ]);
  });

  it('reports a single missing era as a one-era gap', () => {
    expect(analyseCoverage([10, 12])).toEqual({
      coverage: { firstEra: 10, lastEra: 10 },
      gaps: [{ from: 11, to: 11 }],
    });
  });

  it('handles a gap immediately after the first era', () => {
    // The oldest era is still the cursor start; the span is just one era long.
    expect(analyseCoverage([100, 200, 201, 202])).toEqual({
      coverage: { firstEra: 100, lastEra: 100 },
      gaps: [{ from: 101, to: 199 }],
    });
  });

  it('tolerates duplicates without inventing a gap', () => {
    // Chunks can legitimately overlap when a trailing chunk is rewritten.
    expect(analyseCoverage([5, 5, 6, 6, 6, 7])).toEqual({
      coverage: { firstEra: 5, lastEra: 7 },
      gaps: [],
    });
  });

  it('sorts unordered input rather than mistaking order for a gap', () => {
    // Chunks are read in manifest order, which is not guaranteed ascending.
    expect(analyseCoverage([7, 5, 6])).toEqual({
      coverage: { firstEra: 5, lastEra: 7 },
      gaps: [],
    });
  });

  it('is idempotent — re-analysing its own contiguous span is stable', () => {
    const first = analyseCoverage([1663, 1664, 1665, 1800]);
    const contiguous = Array.from(
      { length: first.coverage!.lastEra - first.coverage!.firstEra + 1 },
      (_, i) => first.coverage!.firstEra + i,
    );

    expect(analyseCoverage(contiguous).coverage).toEqual(first.coverage);
    expect(analyseCoverage(contiguous).gaps).toEqual([]);
  });

  it('lets the next run resume exactly at the first missing era', () => {
    // The property the pipeline actually depends on: cursor + 1 is the first
    // era to fetch, and it must fall inside the first gap.
    const stored = [1663, 1664, 1665, 1670, 1671];
    const { coverage, gaps } = analyseCoverage(stored);

    const resumeAt = coverage!.lastEra + 1;
    expect(resumeAt).toBe(1666);
    expect(resumeAt).toBe(gaps[0]!.from);
  });
});
