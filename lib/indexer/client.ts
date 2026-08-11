import { resolveIndexerUrl } from '@/config/networks';

/**
 * The SubQuery indexer client.
 *
 * Reward history is the one thing genuinely unavailable from chain state:
 * `staking.erasValidatorReward` says what an era paid in total, but who was
 * paid what is only recoverable from `Rewarded` events. The indexer has them;
 * current state does not, at any depth.
 *
 * Deliberately plain `fetch` against the GraphQL endpoint rather than a client
 * library. We issue two query shapes in total, we do not want a normalised
 * cache (TanStack Query already provides one), and every GraphQL client worth
 * the name costs more than the queries do. It also keeps this module free of
 * any Polkadot dependency, so `/my-staking` can show reward history for a
 * pasted address without loading megabytes.
 *
 * The endpoint is rate-limited by an amount nobody has documented (Q5), which
 * is why `fetchAllPages` is sequential rather than parallel.
 */

/** The endpoint caps a single response at 100 rows regardless of what we ask. */
export const INDEXER_PAGE_SIZE = 100;

/** A hard stop, so a pathological account cannot spin forever. */
const MAX_PAGES = 200;

export class IndexerError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'IndexerError';
  }
}

export interface GraphQlOptions {
  signal?: AbortSignal | undefined;
  /** Overrides the configured endpoint. Tests and local indexers only. */
  endpoint?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * One GraphQL request.
 *
 * GraphQL answers `200 OK` with an `errors` array for a failed query, so the
 * status code alone is not a success signal — checking only `response.ok` here
 * would surface a schema error as "no rewards found", which is the most
 * dangerous possible misreading on a page about someone's money.
 */
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  { signal, endpoint, fetchImpl = fetch }: GraphQlOptions = {},
): Promise<T> {
  const url = endpoint ?? resolveIndexerUrl();

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new IndexerError(
      'Could not reach the indexer. Reward history is unavailable right now.',
      undefined,
      { cause },
    );
  }

  if (!response.ok) {
    throw new IndexerError(
      `The indexer returned ${response.status}.`,
      response.status === 429 ? 'The endpoint is rate-limited; try again shortly.' : undefined,
    );
  }

  let body: GraphQlResponse<T>;
  try {
    body = (await response.json()) as GraphQlResponse<T>;
  } catch (cause) {
    throw new IndexerError('The indexer returned a response we could not read.', undefined, {
      cause,
    });
  }

  if (body.errors?.length) {
    throw new IndexerError(
      'The indexer rejected the query.',
      body.errors.map((e) => e.message).join('; '),
    );
  }

  if (body.data == null) {
    throw new IndexerError('The indexer returned no data.');
  }

  return body.data;
}

/**
 * Parses an indexer timestamp to unix seconds.
 *
 * The endpoint emits UTC without a zone marker (`2021-11-06T17:26:18`), and
 * `Date.parse` treats a bare datetime as *local* time — so on any machine east
 * or west of UTC every reward would shift by hours, which on a daily era is
 * enough to land in the wrong one. Appending `Z` fixes that, but only when the
 * string does not already carry a zone, or the result is `…ZZ` and `NaN`.
 *
 * Widths vary too — fractional seconds appear inconsistently — which is the
 * same reason this field must never be used as a sort key.
 *
 * Returns 0 for anything unreadable, matching the "one bad row must not blank
 * a whole history" rule the callers follow.
 */
export function parseIndexerDate(datetime: string | null | undefined): number {
  if (!datetime) return 0;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(datetime) ? datetime : `${datetime}Z`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export interface Page<T> {
  nodes: T[];
  hasNextPage: boolean;
}

/**
 * Walks every page of a paginated query.
 *
 * Sequential on purpose. The endpoint's rate limit is undocumented, and an
 * account with years of history is dozens of requests — firing them in
 * parallel is exactly the behaviour that gets an endpoint to start refusing,
 * and this runs in a user's browser where a 429 is visible.
 *
 * `MAX_PAGES` bounds it. Hitting the cap returns what was collected and flags
 * it rather than throwing: a partial reward history is still useful, and the
 * caller can say so.
 */
export async function fetchAllPages<T>(
  loadPage: (offset: number) => Promise<Page<T>>,
): Promise<{ nodes: T[]; truncated: boolean }> {
  const nodes: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { nodes: batch, hasNextPage } = await loadPage(page * INDEXER_PAGE_SIZE);
    nodes.push(...batch);

    // An empty page also ends the walk: an indexer that reports `hasNextPage`
    // while returning nothing would otherwise loop to the cap for no reason.
    if (!hasNextPage || batch.length === 0) return { nodes, truncated: false };
  }

  return { nodes, truncated: true };
}
