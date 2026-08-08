import type { ApiLike } from './compat';

/**
 * The browser's connection to the chain — lazily created, reference-counted,
 * and torn down when nothing needs it.
 *
 * Three separate features want a socket: connecting a wallet, inspecting a
 * pasted stash, and the Live toggle. Each opening its own would mean up to
 * three connections and three copies of the metadata, and — worse — turning
 * Live off would not actually close anything if a wallet were also connected.
 *
 * So there is exactly one connection, and callers `acquire()` a lease on it.
 * The socket opens on the first lease and closes when the last one is released.
 * That makes "disabling Live tears down every subscription" a property of the
 * design rather than something each caller has to remember.
 *
 * **`@polkadot/api` is imported dynamically and nowhere else in client code.**
 * The whole performance argument depends on it: statically imported it is
 * megabytes before any application code, which is what the previous app
 * shipped to every visitor whether they connected a wallet or not. The lint
 * rule in `eslint.config.mjs` enforces this, and `npm run assert:lazy` checks
 * the built output rather than trusting the rule.
 */

export interface ApiLease {
  api: ApiLike;
  /** Idempotent. Releasing twice must not close someone else's connection. */
  release: () => void;
}

/** Injectable so tests can exercise the lifecycle without a chain. */
export interface ApiFactory {
  (endpoint: string): Promise<{ api: ApiLike; disconnect: () => Promise<void> }>;
}

interface Connection {
  endpoint: string;
  leases: number;
  /** Held as a promise so concurrent acquires share one dial. */
  pending: Promise<{ api: ApiLike; disconnect: () => Promise<void> }>;
}

let current: Connection | null = null;

/**
 * The real factory. Separate from `connect()` in `lib/chain/connect.ts`, which
 * is tuned for the pipeline: long timeouts, aggressive retries and console
 * logging are right for a scheduled job and wrong in front of a user, who would
 * rather be told it failed than wait 45 seconds in silence.
 */
/**
 * How long to wait for the first connection before giving up.
 *
 * There must be a bound, and finding out why cost a screenshot. `WsProvider`
 * auto-reconnects by default, which is right for a transient drop mid-session —
 * but it means the *initial* `ApiPromise.create` never rejects when the
 * endpoint is unreachable. It simply retries forever behind the scenes while
 * the UI shows a skeleton, which is precisely the "spinner turning forever with
 * no message" failure this rebuild exists to remove.
 *
 * Shorter than the pipeline's 45s: a scheduled job can afford to wait, a person
 * looking at a page cannot.
 */
const CONNECT_TIMEOUT_MS = 12_000;

const defaultFactory: ApiFactory = async (endpoint) => {
  const { ApiPromise, WsProvider } = await import('@polkadot/api');
  type ProviderInterface = ConstructorParameters<typeof ApiPromise>[0] extends
    { provider?: infer P } | undefined
    ? P
    : never;

  // Auto-reconnect left on, so a drop mid-session heals without the user doing
  // anything; the timeout below covers the initial dial that it would otherwise
  // retry silently and indefinitely.
  const provider = new WsProvider(endpoint);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const api = await Promise.race([
      ApiPromise.create({ provider: provider as ProviderInterface, noInitWarn: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Could not reach ${endpoint} within ${CONNECT_TIMEOUT_MS / 1000}s. The node may be down or blocked by your network.`,
              ),
            ),
          CONNECT_TIMEOUT_MS,
        );
      }),
    ]);

    return {
      api,
      disconnect: async () => {
        await api.disconnect();
      },
    };
  } catch (error) {
    // Release the socket, or the provider keeps retrying in the background
    // forever after we have already reported failure.
    await provider.disconnect().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

let factory: ApiFactory = defaultFactory;

/** Test seam. Passing `null` restores the real factory. */
export function setApiFactory(next: ApiFactory | null): void {
  factory = next ?? defaultFactory;
}

/**
 * Takes a lease on the shared connection, opening it if necessary.
 *
 * A failed dial does not leave a broken connection cached: the entry is cleared
 * so the next attempt genuinely retries rather than re-awaiting a rejected
 * promise forever.
 */
export async function acquireApi(endpoint: string): Promise<ApiLease> {
  // An endpoint change means a different chain; drop the old one rather than
  // silently serving state from the wrong network.
  if (current != null && current.endpoint !== endpoint) {
    void teardown(current);
    current = null;
  }

  if (current == null) {
    const connection: Connection = {
      endpoint,
      leases: 0,
      pending: factory(endpoint),
    };
    current = connection;

    connection.pending.catch(() => {
      if (current === connection) current = null;
    });
  }

  const connection = current;
  connection.leases += 1;

  // Idempotency has to be per *lease*, not per connection: a shared guard on
  // the counter stops it going negative but still lets one caller releasing
  // three times decrement away two other callers' leases and close the socket
  // underneath them.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseLease(connection);
  };

  try {
    const { api } = await connection.pending;
    return { api, release };
  } catch (error) {
    release();
    throw error;
  }
}

function releaseLease(connection: Connection): void {
  connection.leases -= 1;
  if (connection.leases > 0) return;

  if (current === connection) current = null;
  void teardown(connection);
}

async function teardown(connection: Connection): Promise<void> {
  try {
    const { disconnect } = await connection.pending;
    await disconnect();
  } catch {
    // A connection that never opened has nothing to close, and a disconnect
    // failure is not something a user can act on.
  }
}

/** Open connections. Zero or one — exposed so tests can assert teardown. */
export function activeConnectionCount(): number {
  return current == null ? 0 : 1;
}

/** Outstanding leases on the current connection. */
export function activeLeaseCount(): number {
  return current?.leases ?? 0;
}

/** Drops everything. For tests, and for a hard reset after a fatal error. */
export async function resetApi(): Promise<void> {
  const connection = current;
  current = null;
  if (connection) await teardown(connection);
}
