import { describe, expect, it } from 'vitest';
import {
  chunkEndForEra,
  chunkPath,
  chunkStartForEra,
  chunkStartsForRange,
  chunksForRange,
  groupErasByChunk,
  isChunkComplete,
} from './chunking';
import type { ChunkRef } from '@/lib/schemas/data';

const SIZE = 32;

function ref(from: number, complete = true): ChunkRef {
  return { from, to: from + SIZE - 1, path: chunkPath(from), hash: 'deadbeef', complete };
}

describe('chunk boundaries', () => {
  it('aligns to absolute multiples of the chunk size', () => {
    expect(chunkStartForEra(0, SIZE)).toBe(0);
    expect(chunkStartForEra(31, SIZE)).toBe(0);
    expect(chunkStartForEra(32, SIZE)).toBe(32);
    expect(chunkStartForEra(1403, SIZE)).toBe(1376);
  });

  it('derives the end from the start', () => {
    expect(chunkEndForEra(1403, SIZE)).toBe(1407);
  });

  it('builds a stable path from the start era', () => {
    expect(chunkPath(1376)).toBe('chunks/1376.json');
  });

  it('keeps alignment independent of the first ingested era', () => {
    // A backfill must be able to prepend older chunks without renaming any
    // existing file, which only holds if alignment is absolute.
    expect(chunkStartForEra(1376, SIZE)).toBe(1376);
    expect(chunkStartForEra(100, SIZE)).toBe(96);
  });
});

describe('chunkStartsForRange', () => {
  it('covers a range spanning several chunks', () => {
    expect(chunkStartsForRange(1370, 1410, SIZE)).toEqual([1344, 1376, 1408]);
  });

  it('returns one chunk for a range inside a single chunk', () => {
    expect(chunkStartsForRange(1380, 1390, SIZE)).toEqual([1376]);
  });

  it('handles a single era', () => {
    expect(chunkStartsForRange(1403, 1403, SIZE)).toEqual([1376]);
  });

  it('returns nothing for an inverted range instead of throwing', () => {
    expect(chunkStartsForRange(100, 50, SIZE)).toEqual([]);
  });

  it('resolves a 90-era window to three chunks', () => {
    // The payload argument for the default view rests on this.
    expect(chunkStartsForRange(1314, 1403, SIZE)).toHaveLength(3);
  });
});

describe('chunksForRange', () => {
  const manifest = [ref(1312), ref(1344), ref(1376, false)];

  it('selects only overlapping chunks', () => {
    expect(chunksForRange(manifest, 1350, 1360).map((c) => c.from)).toEqual([1344]);
  });

  it('includes partially overlapping chunks at both ends', () => {
    // 1340 falls inside chunk 1312 (1312-1343) and 1380 inside chunk 1376,
    // so all three chunks are needed even though neither end is aligned.
    expect(chunksForRange(manifest, 1340, 1380).map((c) => c.from)).toEqual([1312, 1344, 1376]);
  });

  it('returns results ascending regardless of manifest order', () => {
    const shuffled = [ref(1376), ref(1312), ref(1344)];
    expect(chunksForRange(shuffled, 1300, 1400).map((c) => c.from)).toEqual([1312, 1344, 1376]);
  });

  it('skips eras with no chunk rather than failing', () => {
    // A range may legitimately extend past ingested history; coverage is
    // reported by the UI, not enforced here.
    expect(chunksForRange(manifest, 1, 100)).toEqual([]);
  });

  it('returns nothing for an inverted range', () => {
    expect(chunksForRange(manifest, 1400, 1300)).toEqual([]);
  });
});

describe('groupErasByChunk', () => {
  it('groups eras under their chunk start', () => {
    const groups = groupErasByChunk([1375, 1376, 1377], SIZE);
    expect([...groups.keys()]).toEqual([1344, 1376]);
    expect(groups.get(1344)).toEqual([1375]);
    expect(groups.get(1376)).toEqual([1376, 1377]);
  });

  it('sorts input before grouping', () => {
    const groups = groupErasByChunk([1377, 1376], SIZE);
    expect(groups.get(1376)).toEqual([1376, 1377]);
  });

  it('handles an empty input', () => {
    expect(groupErasByChunk([], SIZE).size).toBe(0);
  });
});

describe('isChunkComplete', () => {
  it('is complete when full and entirely in the past', () => {
    expect(isChunkComplete(1344, SIZE, 1400, SIZE)).toBe(true);
  });

  it('is incomplete when not every era is present', () => {
    expect(isChunkComplete(1344, 10, 1400, SIZE)).toBe(false);
  });

  it('is incomplete when its last era is still the current one', () => {
    // Freezing here would cache a partially-written era forever.
    expect(isChunkComplete(1376, SIZE, 1407, SIZE)).toBe(true);
    expect(isChunkComplete(1376, SIZE, 1406, SIZE)).toBe(false);
  });
});
