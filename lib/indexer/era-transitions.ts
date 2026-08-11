import { graphql, INDEXER_PAGE_SIZE, type GraphQlOptions } from './client';

/**
 * Every era transition the chain has ever recorded.
 *
 * The chain prunes era storage past `historyDepth`, so "when did era 300 start"
 * is unanswerable from current state. It is, however, an *event*, and events are
 * kept forever by the indexer — which makes this the cheapest complete answer
 * available: about eighteen requests for the whole history.
 *
 * **Two event names, not one.** `staking.EraPayout` covers eras 0–1120 and
 * `staking.EraPaid` covers 1121 onward; the pallet renamed it across a runtime
 * upgrade. Measured on mainnet: 1,121 + 628 = 1,749 transitions, contiguous from
 * era 0. Querying either name alone silently loses most of the chain's life —
 * the same trap as `Reward` versus `Rewarded` in the reward query.
 *
 * `eventArg0` is the era index in both spellings. It arrives as a string.
 */

/**
 * One era transition.
 *
 * **`era` is the era that *ended* here, not the one that began.** Verified
 * against our own ingest, which reads `erasStartSessionIndex` from chain
 * storage: era 1748 started 2026-08-09T13:26:12, and `EraPaid(1748)` fired at
 * 2026-08-10T13:26:12 — exactly one era later. So an event tagged era N marks
 * the boundary at which N finished and N+1 began.
 *
 * Getting this backwards is a silent off-by-one that mislabels every era by a
 * day, which is why `buildEraIndex` does the shift in one documented place
 * rather than leaving each caller to remember it.
 */
export interface EraTransition {
  /** The era that ended at this point. */
  era: number;
  /** Block the transition event was recorded in. */
  block: number;
  /** Unix seconds of that block — the end of `era`, and the start of `era + 1`. */
  at: number;
}

interface RawEvent {
  eventArg0: string | null;
  blockId: string;
  block: { datetime: string } | null;
}

interface EventsResponse {
  events: { totalCount: number; nodes: RawEvent[] };
}

/**
 * Ordered by `BLOCK_ID_ASC`, which is safe and deliberate: `blockId` is
 * zero-padded to a fixed width, so a string sort is a numeric sort. This is the
 * chain's own causal order. Sorting on the block's datetime would not be safe —
 * that field's format is not fixed-width, so its string comparison is not
 * reliably chronological.
 */
const ERA_TRANSITIONS_QUERY = `
  query EraTransitions($first: Int!, $offset: Int!) {
    events(
      filter: {
        moduleId: { equalTo: staking }
        eventId: { in: [EraPaid, EraPayout] }
      }
      orderBy: [BLOCK_ID_ASC]
      first: $first
      offset: $offset
    ) {
      totalCount
      nodes {
        eventArg0
        blockId
        block { datetime }
      }
    }
  }
`;

/**
 * Walks every era transition, oldest first.
 *
 * Sequential, like every other paginated read here: the endpoint's rate limit is
 * undocumented, and this is a pipeline job with no deadline. `onProgress` exists
 * so a run that takes twenty requests can say so rather than appearing hung.
 */
export async function fetchEraTransitions(
  options: GraphQlOptions & { onProgress?: (loaded: number, total: number) => void } = {},
): Promise<EraTransition[]> {
  const { onProgress, ...graphqlOptions } = options;
  const transitions: EraTransition[] = [];
  let total = Infinity;

  for (let offset = 0; offset < total; offset += INDEXER_PAGE_SIZE) {
    const data = await graphql<EventsResponse>(
      ERA_TRANSITIONS_QUERY,
      { first: INDEXER_PAGE_SIZE, offset },
      graphqlOptions,
    );

    total = data.events.totalCount;
    if (data.events.nodes.length === 0) break;

    for (const node of data.events.nodes) {
      const transition = toTransition(node);
      if (transition) transitions.push(transition);
    }
    onProgress?.(transitions.length, total);
  }

  return transitions;
}

/** A row we cannot read is dropped, not defaulted — see `buildEraIndex`. */
export function toTransition(node: RawEvent): EraTransition | null {
  const era = Number.parseInt(node.eventArg0 ?? '', 10);
  const block = Number.parseInt(node.blockId, 10);
  // The indexer's datetimes carry no zone marker but are UTC.
  const parsed = node.block?.datetime ? Date.parse(`${node.block.datetime}Z`) : NaN;

  if (!Number.isFinite(era) || !Number.isFinite(block) || !Number.isFinite(parsed)) return null;
  return { era, block, at: Math.floor(parsed / 1000) };
}

export interface EraIndexBuild {
  firstEra: number;
  block: number[];
  start: number[];
}

/**
 * Turns transitions into era *starts*, in the contiguous columnar form the
 * client binary-searches.
 *
 * **The shift lives here and nowhere else.** A transition tagged era N is the
 * moment N ended, so it is the moment N+1 began: `start(N+1) = transition(N)`.
 * Every entry therefore moves up by one, and the index covers eras
 * `firstTransition + 1` through `lastTransition + 1`.
 *
 * Era 0's start is *not* recoverable from this source — it is genesis, and no
 * transition precedes it — so the index simply begins at era 1. Inventing a
 * start for era 0 by subtracting 24 hours would be a guess, and era 0 is
 * exactly the kind of edge a reconciliation would land on.
 *
 * **Throws on a gap rather than filling one.** A missing era would shift every
 * subsequent entry by one, so every era after the gap would report the wrong
 * date — the kind of error that looks entirely plausible in a CSV and is
 * invisible until someone reconciles it against an explorer. If the indexer is
 * missing a transition, the right response is to fail the run and find out why.
 */
export function buildEraIndex(transitions: readonly EraTransition[]): EraIndexBuild {
  if (transitions.length === 0) throw new Error('No era transitions returned by the indexer.');

  // Sorted and de-duplicated defensively: pagination is by offset, and an
  // offset walk over a table that is being written to can repeat a row.
  const byEra = new Map<number, EraTransition>();
  for (const transition of transitions) byEra.set(transition.era, transition);
  const eras = [...byEra.keys()].sort((a, b) => a - b);

  const firstEra = eras[0]!;
  const lastEra = eras.at(-1)!;
  const expected = lastEra - firstEra + 1;

  if (eras.length !== expected) {
    const missing: number[] = [];
    for (let era = firstEra; era <= lastEra && missing.length < 10; era += 1) {
      if (!byEra.has(era)) missing.push(era);
    }
    throw new Error(
      `Era index has gaps: expected ${expected} eras from ${firstEra} to ${lastEra}, got ` +
        `${eras.length}. Missing: ${missing.join(', ')}${missing.length >= 10 ? ', …' : ''}`,
    );
  }

  return {
    // +1: a transition tagged era N is the start of era N+1.
    firstEra: firstEra + 1,
    block: eras.map((era) => byEra.get(era)!.block),
    start: eras.map((era) => byEra.get(era)!.at),
  };
}
