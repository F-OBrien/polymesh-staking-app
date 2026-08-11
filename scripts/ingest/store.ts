/**
 * Reading and writing the generated data directory.
 *
 * Two properties matter here and both are load-bearing:
 *
 *  1. **Atomic writes.** Every file is written to a temporary path and renamed.
 *     A run interrupted mid-write must never leave a truncated JSON file where
 *     a valid one used to be — the site serves these directly, so a partial
 *     write is a user-visible outage.
 *  2. **Validate on both sides.** Everything is parsed through its schema on
 *     read *and* on write. A pipeline bug that produces a malformed chunk fails
 *     the run instead of publishing bad data that only breaks in the browser.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import {
  ChunkSchema,
  EraIndexSchema,
  LatestSchema,
  ManifestSchema,
  OperatorRegistrySchema,
  RollupSchema,
  SlashesSchema,
  type Chunk,
  type EraIndexFile,
  type Latest,
  type Manifest,
  type OperatorRegistry,
  type Rollup,
  type Slashes,
} from '../../lib/schemas/data';
import { chunkPath } from '../../lib/data/chunking';

export const MANIFEST_FILE = 'manifest.json';
export const LATEST_FILE = 'latest.json';
export const OPERATORS_FILE = 'operators.json';
export const ROLLUP_FILE = 'rollup-weekly.json';
export const SLASHES_FILE = 'slashes.json';
export const ERA_INDEX_FILE = 'era-index.json';

export class DataStore {
  constructor(private readonly root: string) {}

  private path(relative: string): string {
    return join(this.root, relative);
  }

  private async readJson<S extends z.ZodType>(
    relative: string,
    schema: S,
  ): Promise<z.infer<S> | null> {
    const absolute = this.path(relative);
    if (!existsSync(absolute)) return null;

    const raw = await readFile(absolute, 'utf8');
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${relative} is present but does not match its schema. Refusing to build on top ` +
          `of it — delete it to force a rebuild.\n${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /** Writes via a temp file and rename, so readers never see a partial file. */
  private async writeJson<S extends z.ZodType>(
    relative: string,
    schema: S,
    value: unknown,
  ): Promise<number> {
    const validated = schema.parse(value);
    const absolute = this.path(relative);
    await mkdir(dirname(absolute), { recursive: true });

    const body = JSON.stringify(validated);
    const temp = `${absolute}.tmp`;
    await writeFile(temp, body, 'utf8');
    await rename(temp, absolute);

    return Buffer.byteLength(body);
  }

  readManifest(): Promise<Manifest | null> {
    return this.readJson(MANIFEST_FILE, ManifestSchema);
  }

  writeManifest(manifest: Manifest): Promise<number> {
    return this.writeJson(MANIFEST_FILE, ManifestSchema, manifest);
  }

  readChunk(chunkStart: number): Promise<Chunk | null> {
    return this.readJson(chunkPath(chunkStart), ChunkSchema);
  }

  writeChunk(chunkStart: number, chunk: Chunk): Promise<number> {
    return this.writeJson(chunkPath(chunkStart), ChunkSchema, chunk);
  }

  readOperators(): Promise<OperatorRegistry | null> {
    return this.readJson(OPERATORS_FILE, OperatorRegistrySchema);
  }

  writeOperators(registry: OperatorRegistry): Promise<number> {
    return this.writeJson(OPERATORS_FILE, OperatorRegistrySchema, registry);
  }

  writeLatest(latest: Latest): Promise<number> {
    return this.writeJson(LATEST_FILE, LatestSchema, latest);
  }

  writeRollup(rollup: Rollup): Promise<number> {
    return this.writeJson(ROLLUP_FILE, RollupSchema, rollup);
  }

  readEraIndex(): Promise<EraIndexFile | null> {
    return this.readJson(ERA_INDEX_FILE, EraIndexSchema);
  }

  writeEraIndex(index: EraIndexFile): Promise<number> {
    return this.writeJson(ERA_INDEX_FILE, EraIndexSchema, index);
  }

  readSlashes(): Promise<Slashes | null> {
    return this.readJson(SLASHES_FILE, SlashesSchema);
  }

  writeSlashes(slashes: Slashes): Promise<number> {
    return this.writeJson(SLASHES_FILE, SlashesSchema, slashes);
  }
}

/**
 * Content hash for a chunk, used as the manifest's `hash` and as the client's
 * IndexedDB cache key.
 *
 * Hashing the parsed value rather than the file bytes keeps it stable across
 * incidental formatting changes, so a re-run that produces identical data does
 * not invalidate every client's cache.
 */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
