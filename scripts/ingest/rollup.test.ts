import { describe, expect, it, vi } from 'vitest';
import { buildRollup, type RollupStore } from './rollup';
import type { Chunk, ChunkRef, Rollup } from '../../lib/schemas/data';

/** A chunk of `count` eras where every per-era value is 1, for easy arithmetic. */
function unitChunk(from: number, count: number): Chunk {
  const eras = Array.from({ length: count }, (_, i) => from + i);
  const ones = () => eras.map(() => 1);

  return {
    from,
    to: from + 31,
    eras: eras as [number, ...number[]],
    eraStart: eras.map((era) => era * 86_400),
    network: {
      totalStaked: ones(),
      totalIssuance: ones(),
      validatorReward: ones(),
      totalPoints: ones(),
      activeOperators: ones(),
      nominatorCount: ones(),
      avgCommission: ones(),
      avgApr: ones(),
      aprP10: ones(),
      aprP50: ones(),
      aprP90: ones(),
    },
    operators: {},
    provenance: {
      specVersion: eras.map(() => 8_000_000),
      exposureShape: eras.map(() => 'paged' as const),
      source: eras.map(() => 'live' as const),
    },
  };
}

function makeStore(chunks: readonly Chunk[]) {
  const captured: Rollup[] = [];
  const byFrom = new Map(chunks.map((c) => [c.from, c]));

  const store: RollupStore = {
    readChunk: vi.fn(async (from: number) => byFrom.get(from) ?? null),
    writeRollup: vi.fn(async (rollup: Rollup) => {
      captured.push(rollup);
      return 0;
    }),
  };

  const refs: ChunkRef[] = chunks.map((c) => ({
    from: c.from,
    to: c.to,
    path: `chunks/${c.from}.json`,
    hash: 'x'.repeat(16),
    complete: true,
  }));

  return { store, refs, captured };
}

describe('buildRollup', () => {
  it('buckets eras into weeks of seven', () => {
    const { store, refs, captured } = makeStore([unitChunk(0, 14)]);
    return buildRollup(store, refs).then(() => {
      const rollup = captured[0]!;
      expect(rollup.eraFrom).toEqual([0, 7]);
      expect(rollup.eraTo).toEqual([6, 13]);
    });
  });

  it('averages stocks and sums flows', async () => {
    // The distinction that matters: totalStaked is a balance at a point in
    // time, so a week's value is its average. validatorReward is an amount
    // paid over a period, so a week's value is the sum. Averaging the reward
    // would understate the week sevenfold.
    const { store, refs, captured } = makeStore([unitChunk(0, 7)]);
    await buildRollup(store, refs);

    const rollup = captured[0]!;
    expect(rollup.totalStaked).toEqual([1]);
    expect(rollup.totalIssuance).toEqual([1]);
    expect(rollup.validatorReward).toEqual([7]);
  });

  it('averages ratio series rather than summing them', async () => {
    const { store, refs, captured } = makeStore([unitChunk(0, 7)]);
    await buildRollup(store, refs);
    // An APR of 1 every day is an APR of 1 for the week, not 7.
    expect(captured[0]!.avgApr).toEqual([1]);
  });

  it('leaves a trailing partial week as its own bucket', async () => {
    const { store, refs, captured } = makeStore([unitChunk(0, 9)]);
    await buildRollup(store, refs);

    const rollup = captured[0]!;
    expect(rollup.eraFrom).toEqual([0, 7]);
    // Two eras in the final bucket, so its reward sum is 2, not 7.
    expect(rollup.validatorReward).toEqual([7, 2]);
  });

  it('orders eras across chunks regardless of ref order', async () => {
    const { store, captured } = makeStore([unitChunk(32, 7), unitChunk(0, 7)]);
    const shuffled: ChunkRef[] = [
      { from: 32, to: 63, path: 'chunks/32.json', hash: 'x'.repeat(16), complete: true },
      { from: 0, to: 31, path: 'chunks/0.json', hash: 'x'.repeat(16), complete: true },
    ];
    await buildRollup(store, shuffled);

    expect(captured[0]!.eraFrom).toEqual([0, 32]);
  });

  it('skips chunk refs with no file on disk', async () => {
    const { store, captured } = makeStore([unitChunk(0, 7)]);
    const refs: ChunkRef[] = [
      { from: 0, to: 31, path: 'chunks/0.json', hash: 'x'.repeat(16), complete: true },
      { from: 32, to: 63, path: 'chunks/32.json', hash: 'x'.repeat(16), complete: true },
    ];
    await buildRollup(store, refs);

    expect(captured[0]!.eraFrom).toEqual([0]);
  });

  it('produces an empty rollup when there is nothing to roll up', async () => {
    const { store, captured } = makeStore([]);
    await buildRollup(store, []);
    expect(captured[0]!.weekStart).toEqual([]);
  });
});
