import { CHUNK_SIZE } from '@/config/site';
import type { ChunkRef } from '@/lib/schemas/data';

/**
 * Chunk-boundary arithmetic, shared by the pipeline that writes chunks and the
 * client that resolves an era range to a set of them.
 *
 * Deliberately one module: if the two sides disagreed by even one era the
 * client would request files the pipeline never wrote, and the failure would
 * look like missing data rather than a boundary bug.
 *
 * Chunks are aligned to absolute multiples of CHUNK_SIZE — not to the first era
 * we happen to have ingested. That alignment is what lets a backfill prepend
 * older chunks later without renaming or rewriting a single existing file
 * (design doc §6.5).
 */

/** First era of the chunk containing `era`. */
export function chunkStartForEra(era: number, chunkSize: number = CHUNK_SIZE): number {
  return Math.floor(era / chunkSize) * chunkSize;
}

/** Last era the chunk containing `era` can hold (whether or not it is filled). */
export function chunkEndForEra(era: number, chunkSize: number = CHUNK_SIZE): number {
  return chunkStartForEra(era, chunkSize) + chunkSize - 1;
}

/** Canonical file path for a chunk, relative to the data root. */
export function chunkPath(chunkStart: number): string {
  return `chunks/${chunkStart}.json`;
}

/**
 * Every chunk start covering the inclusive era range, ascending.
 * Returns an empty array for an inverted range rather than throwing — callers
 * routinely derive ranges from user input where `from > to` is transient.
 */
export function chunkStartsForRange(
  fromEra: number,
  toEra: number,
  chunkSize: number = CHUNK_SIZE,
): number[] {
  if (toEra < fromEra) return [];

  const first = chunkStartForEra(fromEra, chunkSize);
  const last = chunkStartForEra(toEra, chunkSize);

  const starts: number[] = [];
  for (let start = first; start <= last; start += chunkSize) starts.push(start);
  return starts;
}

/**
 * The chunks a client must fetch to render an era range.
 *
 * This is what keeps the default view cheap: at ~1,700 eras the full dataset is
 * megabytes, but a 90-era window resolves to three files (design doc §6.5a).
 * Refs the manifest does not list are silently skipped — an era range may
 * legitimately extend past the ingested history, and the UI reports coverage
 * separately rather than failing here.
 */
export function chunksForRange(
  chunks: readonly ChunkRef[],
  fromEra: number,
  toEra: number,
): ChunkRef[] {
  if (toEra < fromEra) return [];
  return chunks
    .filter((chunk) => chunk.from <= toEra && chunk.to >= fromEra)
    .sort((a, b) => a.from - b.from);
}

/**
 * Splits eras into chunk-aligned groups, preserving order within each.
 * Used by the pipeline when writing, and by the fixture generator.
 */
export function groupErasByChunk(
  eras: readonly number[],
  chunkSize: number = CHUNK_SIZE,
): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (const era of [...eras].sort((a, b) => a - b)) {
    const start = chunkStartForEra(era, chunkSize);
    const existing = groups.get(start);
    if (existing) existing.push(era);
    else groups.set(start, [era]);
  }
  return groups;
}

/**
 * A chunk is complete — and therefore immutable and safe to cache forever —
 * only when it holds every era in its span and the chain has moved past it.
 *
 * The `lastCompleteEra` guard matters: a chunk whose span ends exactly at the
 * current era would otherwise be frozen while its final era is still being
 * written, permanently caching a partial era for every visitor.
 */
export function isChunkComplete(
  chunkStart: number,
  eraCount: number,
  lastCompleteEra: number,
  chunkSize: number = CHUNK_SIZE,
): boolean {
  return eraCount === chunkSize && chunkStart + chunkSize - 1 <= lastCompleteEra;
}
