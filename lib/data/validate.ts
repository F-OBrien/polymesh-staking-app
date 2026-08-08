/**
 * Client-side validation of fetched data files.
 *
 * **Zod is deliberately kept out of the production bundle.** Measured in
 * isolation it costs 64.6 KB gzip — 26% of the home page's critical-path
 * JavaScript, and more than every other dependency of ours combined. Paying
 * that on every page load buys very little, because:
 *
 *  - The pipeline already validates every file against these same schemas
 *    *before writing it*, and refuses to publish on failure. That is the
 *    authoritative gate, and it runs in Node where size is irrelevant.
 *  - The residual production risk is not malformed data, it is **version skew**
 *    — a freshly deployed site reading data written by an older pipeline, or the
 *    reverse. A `schemaVersion` check catches exactly that, for no bytes.
 *
 * So: full Zod parsing in development, where contract drift should surface
 * loudly while you are working on it; a cheap structural check in production.
 * The `NODE_ENV` comparison is statically replaced at build time, so the dynamic
 * import below is eliminated from the production bundle rather than merely
 * deferred — verified by measuring the built output, not assumed.
 */

import type { Chunk, Latest, Manifest, OperatorRegistry, Rollup, Slashes } from '@/lib/schemas/data';

/** The expected `schemaVersion` for every versioned file. Bump with the schema. */
const EXPECTED_SCHEMA_VERSION = 1;

export type DataFileKind = 'manifest' | 'chunk' | 'latest' | 'operators' | 'rollup' | 'slashes';

interface KindMap {
  manifest: Manifest;
  chunk: Chunk;
  latest: Latest;
  operators: OperatorRegistry;
  rollup: Rollup;
  slashes: Slashes;
}

export class SchemaMismatchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SchemaMismatchError';
  }
}

/**
 * Minimal production check.
 *
 * Confirms the payload is an object, carries the schema version we compiled
 * against where applicable, and has the one field each consumer immediately
 * dereferences. Anything subtler is the pipeline's job.
 */
function assertShape(kind: DataFileKind, body: unknown): void {
  if (typeof body !== 'object' || body === null) {
    throw new SchemaMismatchError(`${kind}: expected an object.`);
  }

  const record = body as Record<string, unknown>;

  // `chunk` and `operators` are unversioned: a chunk's shape is pinned by the
  // manifest that references it, and the registry is a plain address map.
  if (kind !== 'chunk' && kind !== 'operators') {
    if (record.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      throw new SchemaMismatchError(
        `${kind}: expected schemaVersion ${EXPECTED_SCHEMA_VERSION}, got ${String(
          record.schemaVersion,
        )}. The site and its data are out of step — a redeploy usually resolves it.`,
      );
    }
  }

  const required: Record<DataFileKind, string> = {
    manifest: 'chunks',
    chunk: 'eras',
    latest: 'eraStatus',
    operators: '',
    rollup: 'weekStart',
    slashes: 'events',
  };

  const field = required[kind];
  if (field !== '' && record[field] == null) {
    throw new SchemaMismatchError(`${kind}: missing "${field}".`);
  }
}

/**
 * Validates a fetched payload and returns it typed.
 *
 * In development this runs the real Zod schema. In production it runs
 * `assertShape` and casts — the cast is safe precisely because the pipeline
 * validated the same bytes against the same schema before publishing them.
 */
export async function validateData<K extends DataFileKind>(
  kind: K,
  body: unknown,
): Promise<KindMap[K]> {
  if (process.env.NODE_ENV !== 'production') {
    const schemas = await import('@/lib/schemas/data');
    const schema = {
      manifest: schemas.ManifestSchema,
      chunk: schemas.ChunkSchema,
      latest: schemas.LatestSchema,
      operators: schemas.OperatorRegistrySchema,
      rollup: schemas.RollupSchema,
      slashes: schemas.SlashesSchema,
    }[kind];

    return schema.parse(body) as KindMap[K];
  }

  assertShape(kind, body);
  return body as KindMap[K];
}
