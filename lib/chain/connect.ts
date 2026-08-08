import type { ApiLike } from './compat';

/**
 * Chain connection for the ingestion scripts.
 *
 * `@polkadot/api` is imported dynamically even here, where it would be safe to
 * import statically. Keeping every reference behind `await import()` means the
 * lint rule that protects the client bundle needs no per-file exemption, and
 * nothing can later import this module from app code and quietly drag the
 * Polkadot stack onto the critical path.
 */

export interface ConnectOptions {
  endpoint: string;
  /** Attempts before giving up. Public endpoints refuse connections under load. */
  retries?: number;
  /** Cap on a single attempt, so a silent socket cannot hang the job. */
  readyTimeoutMs?: number;
}

export interface ChainConnection {
  api: ApiLike;
  disconnect: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connect({
  endpoint,
  retries = 4,
  readyTimeoutMs = 45_000,
}: ConnectOptions): Promise<ChainConnection> {
  const { ApiPromise, WsProvider } = await import('@polkadot/api');
  type ProviderInterface = ConstructorParameters<typeof ApiPromise>[0] extends
    { provider?: infer P } | undefined
    ? P
    : never;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let provider: InstanceType<typeof WsProvider> | undefined;

    try {
      // `autoConnectMs: 0` disables the provider's *own* retry loop, so a
      // failure surfaces here where it can be counted and backed off rather
      // than retrying invisibly forever.
      //
      // It also disables connecting at all — the constructor only dials when
      // `autoConnectMs > 0` — so the explicit `connect()` below is required,
      // not belt-and-braces. Without it `ApiPromise.create` waits on a socket
      // that was never opened and the process hangs with no output.
      provider = new WsProvider(endpoint, 0);
      await provider.connect();

      // ProviderInterface declares `ttl: number | null`; WsProvider implements
      // it as an optional property. The two are identical at runtime, but
      // `exactOptionalPropertyTypes` treats them as incompatible — an upstream
      // typing quirk, not a defect here.
      const api = await withTimeout(
        ApiPromise.create({ provider: provider as ProviderInterface, noInitWarn: true }),
        readyTimeoutMs,
        `Timed out after ${readyTimeoutMs / 1000}s waiting for ${endpoint} to become ready`,
      );

      return {
        api,
        disconnect: async () => {
          await api.disconnect();
        },
      };
    } catch (error) {
      lastError = error;
      // Release the socket before retrying; otherwise each failed attempt
      // leaks an open connection and the process will not exit on its own.
      await provider?.disconnect().catch(() => undefined);

      if (attempt < retries) {
        const backoffMs = 2000 * 2 ** attempt;
        console.warn(
          `Connection to ${endpoint} failed (attempt ${attempt + 1}/${retries + 1}): ` +
            `${error instanceof Error ? error.message : String(error)}. ` +
            `Retrying in ${backoffMs / 1000}s`,
        );
        await sleep(backoffMs);
      }
    }
  }

  throw new Error(`Could not connect to ${endpoint} after ${retries + 1} attempts`, {
    cause: lastError,
  });
}

/**
 * Fails a promise that never settles.
 *
 * A websocket can open and then go quiet — the chain never answers the metadata
 * request — in which case `ApiPromise.create` waits indefinitely. An unbounded
 * hang is the worst failure mode for a scheduled job: it burns the whole CI
 * timeout and reports nothing useful.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A view of storage as it was at a historical block.
 *
 * This is what makes backfill possible: era storage is pruned from current
 * state once an era ages past `historyDepth`, but the public Polymesh RPCs are
 * archive nodes, so the state is still readable at a block from when the era
 * was live (design doc §6.5).
 *
 * polkadot-js fetches the runtime metadata as of that block, so decoding is
 * correct per spec version without any work here. What still varies is the
 * *shape* of what is decoded, which `compat.ts` handles.
 */
export async function apiAt(api: ApiLike, blockHash: string): Promise<ApiLike> {
  return api.at(blockHash);
}

/**
 * Runs tasks with bounded concurrency, preserving input order in the result.
 *
 * The ingestion pipeline talks to someone else's public node. A cold run or a
 * backfill is thousands of prefix scans, and firing them all at once is exactly
 * the behaviour that gets endpoints rate-limited — it is also what made the
 * previous app slow, since it issued ~255 concurrent scans from every visitor's
 * browser. Two or three at a time is plenty; this job has no deadline.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}
