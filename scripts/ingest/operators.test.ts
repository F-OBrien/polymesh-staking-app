import { describe, expect, it } from 'vitest';
import { collectSeenEras, mergeSpans, spansFromChunks } from './operators';
import type { Chunk } from '../../lib/schemas/data';

const era = (n: number, ...addresses: string[]) => ({
  era: n,
  operators: addresses.map((address) => ({ address })),
});

describe('collectSeenEras', () => {
  it('records the span each operator was actually present for', () => {
    const seen = collectSeenEras([era(10, 'a', 'b'), era(11, 'a'), era(12, 'a', 'b')]);
    expect(seen.get('a')).toEqual({ firstEra: 10, lastEra: 12 });
    expect(seen.get('b')).toEqual({ firstEra: 10, lastEra: 12 });
  });

  it('does not credit a late arrival with the run’s first era', () => {
    // The bug this exists for. The registry used to take the *run's* bounds and
    // apply them to every operator in it, so an operator that appeared in the
    // last era of a 300-era backfill was recorded as having been there from the
    // start of the slice — which is exactly the `firstSeenEra` complaint the
    // backfill was meant to fix.
    const seen = collectSeenEras([era(100, 'old'), era(101, 'old'), era(102, 'old', 'new')]);
    expect(seen.get('new')).toEqual({ firstEra: 102, lastEra: 102 });
    expect(seen.get('old')).toEqual({ firstEra: 100, lastEra: 102 });
  });

  it('records a departure rather than extending it to the end of the run', () => {
    const seen = collectSeenEras([era(5, 'gone'), era(6, 'gone'), era(7, 'still')]);
    expect(seen.get('gone')?.lastEra).toBe(6);
  });

  it('handles eras arriving out of order', () => {
    // `mapWithConcurrency` preserves order, but nothing downstream should
    // depend on that for a value this hard to recover once wrong.
    const seen = collectSeenEras([era(30, 'a'), era(10, 'a'), era(20, 'a')]);
    expect(seen.get('a')).toEqual({ firstEra: 10, lastEra: 30 });
  });

  it('returns an empty map for no records', () => {
    expect(collectSeenEras([]).size).toBe(0);
  });
});

/** A chunk holding one column per operator, `null` where it was absent. */
const chunk = (from: number, eras: number[], operators: Record<string, (number | null)[]>) => ({
  from,
  eras,
  operators: Object.fromEntries(
    Object.entries(operators).map(([address, points]) => [
      address,
      {
        points,
        totalStake: points.map(() => null),
        commission: [],
        ownStake: [],
        nominatorCount: [],
      },
    ]),
  ),
});

/**
 * `spansFromChunks` reads four fields of a chunk; the fixtures above supply
 * exactly those, so the cast is to `Chunk` once here rather than a loose type
 * threaded through every test.
 */
const fakeStore = (chunks: ReturnType<typeof chunk>[]) => ({
  readChunk: (from: number) =>
    Promise.resolve((chunks.find((c) => c.from === from) ?? null) as unknown as Chunk | null),
});

describe('spansFromChunks', () => {
  it('derives each operator’s span from the eras it actually has data for', async () => {
    const chunks = [chunk(0, [1, 2, 3], { a: [10, 20, 30], b: [null, null, 5] })];
    const spans = await spansFromChunks(fakeStore(chunks), [{ from: 0 }]);
    expect(spans.get('a')).toEqual({ firstEra: 1, lastEra: 3 });
    expect(spans.get('b')).toEqual({ firstEra: 3, lastEra: 3 });
  });

  it('spans several chunks', async () => {
    const chunks = [chunk(0, [1, 2], { a: [1, 2] }), chunk(2, [3, 4], { a: [3, 4] })];
    const spans = await spansFromChunks(fakeStore(chunks), [{ from: 0 }, { from: 2 }]);
    expect(spans.get('a')).toEqual({ firstEra: 1, lastEra: 4 });
  });

  it('skips a chunk it cannot read rather than failing the run', async () => {
    const store = {
      readChunk: (from: number) =>
        from === 0 ? Promise.reject(new Error('corrupt')) : Promise.resolve(null),
    };
    await expect(spansFromChunks(store, [{ from: 0 }, { from: 2 }])).resolves.toEqual(new Map());
  });
});

describe('mergeSpans', () => {
  it('keeps the widest range for each operator', () => {
    const merged = mergeSpans(
      new Map([['a', { firstEra: 10, lastEra: 20 }]]),
      new Map([['a', { firstEra: 5, lastEra: 15 }]]),
    );
    expect(merged.get('a')).toEqual({ firstEra: 5, lastEra: 20 });
  });

  it('carries through operators present in only one map', () => {
    // The reason the registry merges rather than replaces: an operator whose
    // eras have aged out of everything stored still has a known first sighting.
    const merged = mergeSpans(
      new Map([['old', { firstEra: 1, lastEra: 2 }]]),
      new Map([['new', { firstEra: 90, lastEra: 91 }]]),
    );
    expect([...merged.keys()].sort()).toEqual(['new', 'old']);
  });
});
