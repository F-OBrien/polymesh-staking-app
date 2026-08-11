import { describe, expect, it } from 'vitest';
import { rankOperators, seriesCoverage, stitchChunks } from './series';
import type { Chunk, OperatorSeries } from '@/lib/schemas/data';

function operatorSeries(values: (number | null)[]): OperatorSeries {
  return {
    points: values,
    commission: values.map((v) => (v == null ? null : 0.1)),
    totalStake: values,
    ownStake: values,
    nominatorCount: values,
  };
}

function chunk(from: number, eras: number[], operators: Record<string, (number | null)[]>): Chunk {
  const fill = (value: number) => eras.map(() => value);

  return {
    from,
    to: from + 31,
    eras: eras as [number, ...number[]],
    eraStart: eras.map((era) => era * 86_400),
    network: {
      totalStaked: fill(100),
      totalIssuance: fill(1000),
      validatorReward: fill(10),
      totalPoints: fill(500),
      activeOperators: fill(2),
      nominatorCount: fill(50),
      avgCommission: fill(0.1),
      avgApr: fill(0.12),
      aprP10: fill(0.1),
      aprP50: fill(0.12),
      aprP90: fill(0.14),
    },
    operators: Object.fromEntries(
      Object.entries(operators).map(([address, values]) => [address, operatorSeries(values)]),
    ),
    provenance: {
      specVersion: fill(8_000_000),
      exposureShape: eras.map(() => 'paged' as const),
      source: eras.map(() => 'live' as const),
    },
  };
}

describe('stitchChunks', () => {
  it('concatenates chunks into one ascending era axis', () => {
    const series = stitchChunks([
      chunk(0, [0, 1], { alice: [1, 2] }),
      chunk(32, [32, 33], { alice: [3, 4] }),
    ]);

    expect(series.eras).toEqual([0, 1, 32, 33]);
    expect(series.operators.alice!.points).toEqual([1, 2, 3, 4]);
  });

  it('orders output regardless of input chunk order', () => {
    const series = stitchChunks([
      chunk(32, [32, 33], { alice: [3, 4] }),
      chunk(0, [0, 1], { alice: [1, 2] }),
    ]);
    expect(series.eras).toEqual([0, 1, 32, 33]);
    expect(series.operators.alice!.points).toEqual([1, 2, 3, 4]);
  });

  it('pads an operator absent from one chunk instead of misaligning it', () => {
    // This is the bug the whole module exists to prevent: bob appears only in
    // the second chunk. Naive concatenation would shift his values two eras
    // earlier and produce a chart that looks plausible and is wrong.
    const series = stitchChunks([
      chunk(0, [0, 1], { alice: [1, 2] }),
      chunk(32, [32, 33], { alice: [3, 4], bob: [7, 8] }),
    ]);

    expect(series.operators.bob!.points).toEqual([null, null, 7, 8]);
    expect(series.operators.alice!.points).toEqual([1, 2, 3, 4]);
  });

  it('preserves nulls inside a chunk as gaps', () => {
    const series = stitchChunks([chunk(0, [0, 1, 2], { alice: [1, null, 3] })]);
    expect(series.operators.alice!.points).toEqual([1, null, 3]);
  });

  it('clips to a requested era range', () => {
    const series = stitchChunks(
      [chunk(0, [0, 1, 2, 3], { alice: [1, 2, 3, 4] })],
      { fromEra: 1, toEra: 2 },
    );

    expect(series.eras).toEqual([1, 2]);
    expect(series.operators.alice!.points).toEqual([2, 3]);
    expect(series.network.totalStaked).toHaveLength(2);
  });

  it('lets a later chunk win on overlapping eras', () => {
    // A re-fetched trailing chunk stitched alongside a cached copy of itself.
    const series = stitchChunks([
      chunk(0, [0, 1], { alice: [1, 2] }),
      chunk(0, [0, 1], { alice: [9, 9] }),
    ]);
    expect(series.operators.alice!.points).toEqual([9, 9]);
  });

  it('keeps every column the same length as the era axis', () => {
    const series = stitchChunks([
      chunk(0, [0, 1], { alice: [1, 2] }),
      chunk(32, [32], { bob: [5] }),
    ]);

    const n = series.eras.length;
    expect(series.eraStart).toHaveLength(n);
    for (const column of Object.values(series.network)) expect(column).toHaveLength(n);
    for (const op of Object.values(series.operators)) {
      for (const column of Object.values(op)) expect(column).toHaveLength(n);
    }
  });

  it('handles no chunks at all', () => {
    const series = stitchChunks([]);
    expect(series.eras).toEqual([]);
    expect(series.operators).toEqual({});
  });
});

describe('rankOperators', () => {
  it('ranks by the most recent non-null value', () => {
    const series = stitchChunks([
      chunk(0, [0, 1], { small: [1, 1], big: [1, 100], mid: [1, 50] }),
    ]);
    expect(rankOperators(series, 'totalStake', 2)).toEqual(['big', 'mid']);
  });

  it('falls back to an earlier value when the latest era is a gap', () => {
    // An operator that dropped out last era should still rank on what it had.
    const series = stitchChunks([chunk(0, [0, 1], { alice: [80, null], bob: [10, 10] })]);
    expect(rankOperators(series, 'totalStake', 1)).toEqual(['alice']);
  });

  it('excludes operators with no values at all', () => {
    const series = stitchChunks([chunk(0, [0, 1], { ghost: [null, null], real: [1, 1] })]);
    expect(rankOperators(series, 'totalStake', 5)).toEqual(['real']);
  });

  /**
   * Equal stake throughout, so return varies only with points. The default
   * helper ties points to stake, which would make every return identical.
   */
  const byPoints = (points: Record<string, (number | null)[]>) => {
    const eras = Object.values(points)[0]!.map((_, i) => i);
    const base = chunk(
      0,
      eras,
      Object.fromEntries(Object.keys(points).map((k) => [k, eras.map(() => 10)])),
    );
    for (const [address, values] of Object.entries(points)) {
      base.operators[address]!.points = values;
    }
    return stitchChunks([base]);
  };

  it('ranks derived return on the mean, not the latest era', () => {
    // A single era's return is noisy enough that a latest-value ranking would
    // reshuffle the top of the chart every day. `spiky` wins the most recent
    // era outright and still loses on the mean, which is the whole point.
    const series = byPoints({ spiky: [1, 100], steady: [60, 60] });
    expect(rankOperators(series, 'points', 1)).toEqual(['spiky']);
    expect(rankOperators(series, 'aprNet', 1)).toEqual(['steady']);
  });

  it('orders gross and net identically at a flat commission', () => {
    // Commission is a flat 0.1 across the fixture, so it scales every return
    // by the same factor and cannot reorder them.
    const series = byPoints({ a: [10, 10], b: [20, 20] });
    expect(rankOperators(series, 'aprGross', 2)).toEqual(['b', 'a']);
    expect(rankOperators(series, 'aprNet', 2)).toEqual(['b', 'a']);
  });

  it('defaults to return rather than stake', () => {
    // The default matters: Polymesh's election equalises exposure, so ranking
    // by stake is very nearly arbitrary. See `docs/STATUS.md`.
    const series = byPoints({ low: [1, 1], high: [90, 90] });
    expect(rankOperators(series)).toEqual(rankOperators(series, 'aprNet'));
    expect(rankOperators(series, undefined, 1)).toEqual(['high']);
  });
});

describe('seriesCoverage', () => {
  it('reports the inclusive era span', () => {
    const series = stitchChunks([chunk(0, [5, 6, 7], { alice: [1, 2, 3] })]);
    expect(seriesCoverage(series)).toEqual({ fromEra: 5, toEra: 7 });
  });

  it('returns null when empty, so callers must handle "no data"', () => {
    expect(seriesCoverage(stitchChunks([]))).toBeNull();
  });
});
