import { describe, expect, it } from 'vitest';
import { buildComparison, notableDifferences, type MetricDefinition } from './comparison';
import type { OperatorRow } from './operator-rows';

const row = (address: string, overrides: Partial<OperatorRow> = {}): OperatorRow => ({
  address,
  name: address,
  status: 'active',
  commission: 0.1,
  totalStake: 1000,
  ownStake: 100,
  selfStakeRatio: 0.1,
  nominatorCount: 10,
  pageCount: 1,
  blocked: false,
  aprThisEra: null,
  aprThisEraGross: null,
  aprLastEra: null,
  aprLastEraGross: null,
  lastEraIndex: null,
  aprMedianGross: null,
  aprSpreadGross: null,
  pointsThisEra: null,
  aprMedian: 0.2,
  aprSpread: 0.01,
  aprSeries: [],
  pointsShare: 0.01,
  ...overrides,
});

const apr: MetricDefinition = {
  key: 'apr',
  label: 'Return',
  polarity: 'higher',
  value: (r) => r.aprMedian,
  format: (v) => (v == null ? '—' : v.toFixed(3)),
  notableSpread: 0.01,
};

const commission: MetricDefinition = {
  key: 'commission',
  label: 'Commission',
  polarity: 'lower',
  value: (r) => r.commission,
  format: (v) => (v == null ? '—' : v.toFixed(3)),
  notableSpread: 0.02,
};

const stake: MetricDefinition = {
  key: 'stake',
  label: 'Stake',
  polarity: 'none',
  value: (r) => r.totalStake,
  format: (v) => (v == null ? '—' : String(v)),
};

describe('buildComparison', () => {
  it('marks the highest value best when higher is better', () => {
    const [result] = buildComparison([row('a', { aprMedian: 0.2 }), row('b', { aprMedian: 0.25 })], [apr]);
    expect(result!.cells.map((c) => c.best)).toEqual([false, true]);
  });

  it('marks the lowest value best when lower is better', () => {
    const [result] = buildComparison(
      [row('a', { commission: 0.3 }), row('b', { commission: 0.05 })],
      [commission],
    );
    expect(result!.cells.map((c) => c.best)).toEqual([false, true]);
  });

  it('marks nothing best for a metric with no polarity', () => {
    // Bigger stake is not better — it is the opposite for decentralisation, and
    // implying otherwise would push nominators toward the largest operators.
    const [result] = buildComparison([row('a', { totalStake: 10 }), row('b', { totalStake: 99 })], [
      stake,
    ]);
    expect(result!.cells.every((c) => !c.best)).toBe(true);
  });

  it('marks every tied operator best, not an arbitrary one', () => {
    const [result] = buildComparison(
      [row('a', { aprMedian: 0.2 }), row('b', { aprMedian: 0.2 }), row('c', { aprMedian: 0.1 })],
      [apr],
    );
    // 'a' and 'b' tie at the top, so both are best and 'c' is not.
    expect(result!.cells.map((c) => c.best)).toEqual([true, true, false]);
  });

  it('treats values equal within floating-point noise as jointly best', () => {
    // 0.1 + 0.2 is not exactly 0.3. Two operators whose averages differ only in
    // the last bit must both be marked best — one winning on the seventeenth
    // decimal is an artefact, not a finding. A third, clearly lower, keeps this
    // distinct from the all-tied case.
    const [result] = buildComparison(
      [row('a', { aprMedian: 0.1 + 0.2 }), row('b', { aprMedian: 0.3 }), row('c', { aprMedian: 0.2 })],
      [apr],
    );
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(result!.cells.map((c) => c.best)).toEqual([true, true, false]);
  });

  it('marks nothing best when every operator ties', () => {
    // A row where all values are identical is not a comparison; lighting every
    // cell up would suggest a difference that does not exist.
    const [result] = buildComparison([row('a'), row('b'), row('c')], [apr]);
    expect(result!.cells.every((c) => !c.best)).toBe(true);
  });

  it('marks nothing best when only one operator has a value', () => {
    const [result] = buildComparison([row('a', { aprMedian: 0.2 }), row('b', { aprMedian: null })], [apr]);
    expect(result!.cells.every((c) => !c.best)).toBe(true);
  });

  it('never marks a missing value as best', () => {
    const [result] = buildComparison(
      [row('a', { commission: null }), row('b', { commission: 0.2 }), row('c', { commission: 0.3 })],
      [commission],
    );
    expect(result!.cells[0]!.best).toBe(false);
    expect(result!.cells[1]!.best).toBe(true);
  });

  it('computes the spread from known values only', () => {
    const [result] = buildComparison(
      [row('a', { aprMedian: 0.1 }), row('b', { aprMedian: null }), row('c', { aprMedian: 0.3 })],
      [apr],
    );
    expect(result!.spread).toBeCloseTo(0.2, 12);
  });

  it('has a null spread when fewer than two values are known', () => {
    const [result] = buildComparison([row('a', { aprMedian: 0.1 })], [apr]);
    expect(result!.spread).toBeNull();
    expect(result!.notable).toBe(false);
  });

  it('formats every cell, including missing ones', () => {
    const [result] = buildComparison([row('a', { aprMedian: null })], [apr]);
    expect(result!.cells[0]!.display).toBe('—');
  });

  it('keeps cells in the order the operators were given', () => {
    const [result] = buildComparison([row('z'), row('a')], [apr]);
    expect(result!.cells.map((c) => c.address)).toEqual(['z', 'a']);
  });
});

describe('notableDifferences', () => {
  it('keeps only metrics whose spread exceeds their own threshold', () => {
    const rows = buildComparison(
      // APR spread 0.05 (> 0.01, notable); commission spread 0.001 (< 0.02, not).
      [
        row('a', { aprMedian: 0.2, commission: 0.1 }),
        row('b', { aprMedian: 0.25, commission: 0.101 }),
      ],
      [apr, commission],
    );
    expect(notableDifferences(rows).map((r) => r.key)).toEqual(['apr']);
  });

  it('ranks by multiples of each threshold, not by raw spread', () => {
    // Commission spread 0.1 = 5x its 0.02 threshold.
    // APR spread 0.08 = 8x its 0.01 threshold — smaller in absolute terms but
    // the more surprising of the two, so it must rank first.
    const rows = buildComparison(
      [
        row('a', { aprMedian: 0.2, commission: 0.0 }),
        row('b', { aprMedian: 0.28, commission: 0.1 }),
      ],
      [commission, apr],
    );
    expect(notableDifferences(rows).map((r) => r.key)).toEqual(['apr', 'commission']);
  });

  it('excludes metrics with no threshold set', () => {
    const rows = buildComparison([row('a', { totalStake: 1 }), row('b', { totalStake: 1e9 })], [stake]);
    expect(notableDifferences(rows)).toEqual([]);
  });

  it('returns nothing when every operator is alike', () => {
    const rows = buildComparison([row('a'), row('b')], [apr, commission]);
    expect(notableDifferences(rows)).toEqual([]);
  });
});
