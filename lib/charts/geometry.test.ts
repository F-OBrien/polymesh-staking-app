import { describe, expect, it } from 'vitest';
import {
  bandPath,
  linePath,
  nearestIndex,
  plotBox,
  responsiveMargin,
  spreadLabels,
  tickCount,
  timeScale,
  valueScale,
} from './geometry';

describe('plotBox', () => {
  it('subtracts margins from the outer size', () => {
    const box = plotBox(400, 200, { top: 10, right: 20, bottom: 30, left: 40 });
    expect(box.innerWidth).toBe(340);
    expect(box.innerHeight).toBe(160);
  });

  it('clamps to zero rather than going negative', () => {
    // A container can briefly measure smaller than its own margins during
    // layout; a negative range makes d3 emit NaN paths.
    const box = plotBox(10, 10, { top: 20, right: 20, bottom: 20, left: 20 });
    expect(box.innerWidth).toBe(0);
    expect(box.innerHeight).toBe(0);
  });
});

describe('valueScale', () => {
  it('fits the data present', () => {
    const scale = valueScale([[10, 20, 30]], 100);
    const [lo, hi] = scale.domain();
    expect(lo!).toBeLessThanOrEqual(10);
    expect(hi!).toBeGreaterThanOrEqual(30);
  });

  it('inverts the range so larger values sit higher on screen', () => {
    const scale = valueScale([[0, 100]], 100);
    expect(scale(100)).toBeLessThan(scale(0));
  });

  it('ignores nulls rather than treating them as zero', () => {
    // Treating an absent era as 0 would drag the axis floor down and squash
    // every real value into the top of the plot.
    const withNulls = valueScale([[null, 20, 30]], 100).domain();
    const without = valueScale([[20, 30]], 100).domain();
    expect(withNulls).toEqual(without);
  });

  it('does not force zero by default, so rate charts stay readable', () => {
    // An APR series spanning 19-22% must not be plotted against a 0 baseline;
    // that compresses every real difference into a tenth of the plot.
    const [lo] = valueScale([[0.19, 0.22]], 100).domain();
    expect(lo!).toBeGreaterThan(0.1);
  });

  it('includes zero when asked, for magnitudes', () => {
    const [lo] = valueScale([[10, 20]], 100, { includeZero: true }).domain();
    expect(lo!).toBeLessThanOrEqual(0);
  });

  it('respects a hard floor', () => {
    const [lo] = valueScale([[1, 2]], 100, { min: 0, padding: 5 }).domain();
    expect(lo!).toBeGreaterThanOrEqual(0);
  });

  it('gives a flat series room instead of drawing it on the axis', () => {
    const [lo, hi] = valueScale([[5, 5, 5]], 100).domain();
    expect(hi!).toBeGreaterThan(lo!);
  });

  it('falls back to a benign domain when everything is null', () => {
    const domain = valueScale([[null, null]], 100).domain();
    expect(domain.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('spans every series it is given', () => {
    const [lo, hi] = valueScale(
      [
        [1, 2],
        [50, 100],
      ],
      100,
    ).domain();
    expect(lo!).toBeLessThanOrEqual(1);
    expect(hi!).toBeGreaterThanOrEqual(100);
  });
});

describe('timeScale', () => {
  const day = 86_400;
  const start = Date.UTC(2026, 0, 1) / 1000;

  it('maps the first and last era to the plot edges', () => {
    const scale = timeScale([start, start + day, start + 2 * day], 300);
    expect(scale(new Date(start * 1000))).toBeCloseTo(0, 6);
    expect(scale(new Date((start + 2 * day) * 1000))).toBeCloseTo(300, 6);
  });

  it('handles a single era without collapsing the range', () => {
    const scale = timeScale([start], 300);
    const [lo, hi] = scale.domain();
    expect(hi!.getTime()).toBeGreaterThan(lo!.getTime());
  });
});

describe('linePath', () => {
  it('draws a continuous path through defined points', () => {
    const path = linePath([
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: 30 },
    ]);
    expect(path).toMatch(/^M/);
    expect(path).not.toContain('ZM');
  });

  it('breaks at a gap rather than bridging it', () => {
    // Joining across a missing era would draw a line through data that does
    // not exist, implying continuity the operator did not have.
    const path = linePath([
      { x: 0, y: 10 },
      { x: 10, y: null },
      { x: 20, y: 30 },
    ]);
    // A break starts a new subpath, so there is a second move command.
    expect(path.match(/M/g)?.length).toBe(2);
  });

  it('returns an empty string when nothing is defined', () => {
    expect(linePath([{ x: 0, y: null }])).toBe('');
    expect(linePath([])).toBe('');
  });

  it('treats non-finite values as gaps', () => {
    const path = linePath([
      { x: 0, y: 1 },
      { x: 10, y: Number.NaN },
      { x: 20, y: 3 },
    ]);
    expect(path).not.toContain('NaN');
  });
});

describe('bandPath', () => {
  it('produces a closed area', () => {
    const path = bandPath([
      { x: 0, lo: 1, hi: 3 },
      { x: 10, lo: 2, hi: 4 },
    ]);
    expect(path).toMatch(/^M/);
    expect(path).toContain('Z');
  });

  it('breaks where either bound is missing', () => {
    const path = bandPath([
      { x: 0, lo: 1, hi: 3 },
      { x: 10, lo: null, hi: 4 },
      { x: 20, lo: 2, hi: 4 },
    ]);
    expect(path.match(/M/g)?.length).toBe(2);
  });

  it('returns empty for no data', () => {
    expect(bandPath([])).toBe('');
  });
});

describe('tickCount', () => {
  it('scales with available width', () => {
    expect(tickCount(1200)).toBeGreaterThan(tickCount(360));
  });

  it('never drops below two or exceeds ten', () => {
    // Chart text does not reflow, so an unbounded count overlaps at small
    // widths and clutters at large ones.
    expect(tickCount(10)).toBe(2);
    expect(tickCount(100_000)).toBe(10);
  });
});

describe('nearestIndex', () => {
  const xs = [0, 10, 20, 30];

  it('finds the closest point', () => {
    expect(nearestIndex(xs, 11)).toBe(1);
    expect(nearestIndex(xs, 16)).toBe(2);
  });

  it('resolves past either end rather than returning nothing', () => {
    // The crosshair must never flicker out when the pointer leaves the data.
    expect(nearestIndex(xs, -50)).toBe(0);
    expect(nearestIndex(xs, 500)).toBe(3);
  });

  it('returns -1 for an empty series', () => {
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it('picks the first of two equidistant points, deterministically', () => {
    expect(nearestIndex(xs, 15)).toBe(1);
  });
});

describe('responsiveMargin', () => {
  it('reserves a label gutter only when there is room for one', () => {
    expect(responsiveMargin(1200).right).toBeGreaterThan(50);
    // On a 340px chart a 96px gutter is 28% of the width, spent on labels that
    // would then be truncated to uselessness.
    expect(responsiveMargin(340).right).toBeLessThan(20);
  });

  it('narrows the tick gutter on small screens', () => {
    expect(responsiveMargin(390).left).toBeLessThan(responsiveMargin(1200).left);
  });

  it('leaves headroom so the top tick label is not clipped', () => {
    expect(responsiveMargin(1200).top).toBeGreaterThanOrEqual(16);
  });
});

describe('spreadLabels', () => {
  const bounds = { top: 0, bottom: 300 };

  it('leaves well-separated labels where they are', () => {
    const placed = spreadLabels([10, 100, 200], 13, bounds);
    expect(placed.map((p) => p.y)).toEqual([10, 100, 200]);
  });

  it('pushes overlapping labels apart', () => {
    // Observed in practice: three operators with near-identical latest values
    // overprinted into "KDACtlend 3".
    const placed = spreadLabels([100, 102, 104], 13, bounds);
    for (let i = 1; i < placed.length; i += 1) {
      expect(placed[i]!.y - placed[i - 1]!.y).toBeGreaterThanOrEqual(13 - 1e-9);
    }
  });

  it('keeps labels in the same vertical order as their series', () => {
    // Otherwise a label cannot be matched back to its line at all.
    const placed = spreadLabels([104, 100, 102], 13, bounds);
    const order = placed.map((p) => p.index);
    expect(order).toEqual([1, 2, 0]);
  });

  it('drops absent series rather than placing a label for them', () => {
    const placed = spreadLabels([10, null, 200], 13, bounds);
    expect(placed.map((p) => p.index)).toEqual([0, 2]);
  });

  it('pulls the stack back inside when it overflows the bottom', () => {
    const placed = spreadLabels([295, 296, 297, 298], 13, bounds);
    expect(placed.at(-1)!.y).toBeLessThanOrEqual(bounds.bottom);
    expect(placed[0]!.y).toBeGreaterThanOrEqual(bounds.top);
  });

  it('clamps into the plot even when there is no room to separate', () => {
    // Twenty labels needing 13px each will not fit in 100px; crowding inside
    // the plot beats drawing outside it.
    const tight = { top: 0, bottom: 100 };
    const placed = spreadLabels(
      Array.from({ length: 20 }, () => 50),
      13,
      tight,
    );
    for (const p of placed) {
      expect(p.y).toBeGreaterThanOrEqual(tight.top);
      expect(p.y).toBeLessThanOrEqual(tight.bottom);
    }
  });

  it('handles an empty input', () => {
    expect(spreadLabels([], 13, bounds)).toEqual([]);
  });
});
