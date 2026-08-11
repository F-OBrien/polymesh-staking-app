import {
  fetchAllPages,
  graphql,
  INDEXER_PAGE_SIZE,
  parseIndexerDate,
  type GraphQlOptions,
  type Page,
} from './client';

/**
 * Reward history for a stash.
 *
 * The chain records what each era paid in total; it does not record who was
 * paid what. That only exists as `Rewarded` events, so this is the one part of
 * the app that genuinely needs an indexer rather than a snapshot.
 *
 * A regulated-asset chain's holders often have reporting obligations, so the
 * output here has to survive being exported to a spreadsheet and reconciled
 * against a block explorer. That drives two decisions: amounts stay as exact
 * base-unit strings until the last possible moment, and every row keeps its
 * block and era so a figure can be traced back to a specific event.
 */

/**
 * A `Rewarded` staking event.
 *
 * `amount` is a base-unit string, never a number: POLYX has 6 decimals and a
 * lifetime of rewards can exceed what a float represents exactly. Converting
 * early is how reconciliation totals end up off by a few micro-POLYX.
 */
export interface RewardEvent {
  /**
   * The era whose work **earned** this reward — not the era it was paid in.
   *
   * The distinction is real and easy to get backwards, because a payout is
   * always made *after* the era it pays for has closed. A reward at block
   * 129,434 landed one block into era 9, and is payment for era 8. Both are
   * carried here, and both are exported, because "era" alone is ambiguous
   * enough that it should not appear unqualified in a file someone reconciles.
   *
   * Null used to be the *normal* case rather than an edge case: the indexer
   * records a block and not an era, and the block→era mapping came from our own
   * chunks — about 85 eras, against reward histories running for years. It is
   * now filled from `era-index.json`, which covers the chain's whole life, so
   * null means what it should always have meant: genuinely outside the known
   * range. An earlier revision defaulted it to `0`, which exported as a
   * confident "era 0" in a file people use for tax reporting.
   */
  earnedEra: number | null;
  /** The era this payout landed in. Always `earnedEra + 1` when both are known. */
  paidEra: number | null;
  blockNumber: number;
  /** Index of the event within its block. Addresses the event on an explorer. */
  eventIndex: number;
  /** Unix seconds. */
  datetime: number;
  amount: string;
}

interface RawStakingEvent {
  id: string;
  createdBlockId: string;
  eventId: string;
  amount: string | number | null;
  datetime: string;
  stashAccount: string | null;
  identityId: string | null;
}

interface StakingEventsResponse {
  stakingEvents: {
    nodes: RawStakingEvent[];
    pageInfo: { hasNextPage: boolean };
  };
}

/**
 * Every reward paid to a stash, oldest first.
 *
 * Three details here were wrong when this was written blind, and each was found
 * by introspecting the live schema. They are worth spelling out because none of
 * them fails loudly:
 *
 *  - **The block field is `createdBlockId`,** not `blockId`. That one at least
 *    errors — the query 400s.
 *  - **`eventId` must match both `Reward` and `Rewarded`.** Polymesh renamed the
 *    event across a runtime upgrade and the enum carries both spellings.
 *    Filtering on `Rewarded` alone returns only recent history and silently
 *    reports a lifetime total that is missing its early years — the worst kind
 *    of wrong, because it looks entirely plausible.
 *
 * **Ordering is by `CREATED_BLOCK_ID_ASC`, and this was got wrong in both
 * directions.** An earlier revision assumed the id sorted lexicographically and
 * so shuffled history; it was switched to `DATETIME_ASC` on that basis. Both
 * halves of that reasoning were wrong:
 *
 *  - `createdBlockId` is **deliberately zero-padded** to a fixed ten digits
 *    (`"0000129434"`), precisely so that a string sort is a numeric sort.
 *    Verified across the dataset: every id is exactly 10 characters.
 *  - `datetime` is the field that is *not* safe to sort on, because it is also
 *    compared as a string and its format is **not** fixed-width — rows carry
 *    fractional seconds inconsistently (`…T13:26:12` alongside
 *    `…T13:26:12.001`). It happens to agree with block order today, which is
 *    exactly why relying on it is a trap.
 *
 * Block order is also the only *true* order: it is the chain's own causal
 * sequence, whereas a timestamp is a value written into a block and two blocks
 * can carry the same one. `ID_ASC` breaks ties within a block — the id is
 * `blockId/eventIdx`, both padded — so the walk is fully deterministic.
 */
const REWARDS_QUERY = `
  query RewardsForStash($stash: String!, $first: Int!, $offset: Int!) {
    stakingEvents(
      filter: {
        stashAccount: { equalTo: $stash }
        eventId: { in: [Reward, Rewarded] }
      }
      orderBy: [CREATED_BLOCK_ID_ASC, ID_ASC]
      first: $first
      offset: $offset
    ) {
      nodes {
        id
        createdBlockId
        eventId
        amount
        datetime
        stashAccount
        identityId
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

export interface FetchRewardsOptions extends GraphQlOptions {
  /**
   * Which era a payout was *earned* in, given the block it was paid in.
   *
   * Injected rather than computed here, because it needs the era index — every
   * era's start block over the chain's whole life — and this module deliberately
   * knows nothing about our own data files. Returns null for anything it cannot
   * place, which becomes a blank cell rather than an invented era.
   */
  earnedEra?: ((blockNumber: number) => number | null) | undefined;
}

/**
 * Every `Rewarded` event for a stash, oldest first.
 *
 * Returns `truncated` when the page cap was reached, so the UI can say the
 * history is partial rather than quietly showing a wrong lifetime total.
 */
export async function fetchRewards(
  stash: string,
  { earnedEra, ...options }: FetchRewardsOptions = {},
): Promise<{ events: RewardEvent[]; truncated: boolean }> {
  const loadPage = async (offset: number): Promise<Page<RawStakingEvent>> => {
    const data = await graphql<StakingEventsResponse>(
      REWARDS_QUERY,
      { stash, first: INDEXER_PAGE_SIZE, offset },
      options,
    );
    return {
      nodes: data.stakingEvents.nodes,
      hasNextPage: data.stakingEvents.pageInfo.hasNextPage,
    };
  };

  const { nodes, truncated } = await fetchAllPages(loadPage);
  return { events: nodes.map((node) => toRewardEvent(node, earnedEra)), truncated };
}

/**
 * Headline totals for a stash, in **one** request.
 *
 * The detail walk is paginated at 100 rows — a hard server cap, not a setting
 * (asking for 500 or 1000 returns 100). A real account with 11,858 payouts is
 * therefore 119 sequential round trips against someone else's public endpoint,
 * just to print a total.
 *
 * The indexer will do the sum itself. `totalCount` and `aggregates.sum.amount`
 * come back from a single query, so the page can show the lifetime total and
 * the payout count immediately and only walk the detail when a reader actually
 * asks for the chart or the CSV.
 *
 * Verified on mainnet: a stash reporting `totalCount 1763` and
 * `sum 888711733041` in one request. Note the aggregate set is narrow —
 * `min`/`max` over `datetime` are *not* offered, so a date range still needs
 * rows.
 */
const REWARD_SUMMARY_QUERY = `
  query RewardSummaryForStash($stash: String!) {
    totals: stakingEvents(
      filter: {
        stashAccount: { equalTo: $stash }
        eventId: { in: [Reward, Rewarded] }
      }
    ) {
      totalCount
      aggregates { sum { amount } }
    }
    first: stakingEvents(
      filter: {
        stashAccount: { equalTo: $stash }
        eventId: { in: [Reward, Rewarded] }
      }
      orderBy: [CREATED_BLOCK_ID_ASC, ID_ASC]
      first: 1
    ) {
      nodes { id createdBlockId amount datetime }
    }
    last: stakingEvents(
      filter: {
        stashAccount: { equalTo: $stash }
        eventId: { in: [Reward, Rewarded] }
      }
      orderBy: [CREATED_BLOCK_ID_DESC, ID_DESC]
      first: 1
    ) {
      nodes { id createdBlockId amount datetime }
    }
  }
`;

interface SummaryNode {
  id: string;
  createdBlockId: string;
  amount: string | number | null;
  datetime: string;
}

interface SummaryResponse {
  totals: {
    totalCount: number;
    aggregates: { sum: { amount: string | number | null } | null } | null;
  };
  first: { nodes: SummaryNode[] };
  last: { nodes: SummaryNode[] };
}

export interface RewardTotals {
  /** Exact lifetime total, in base units. */
  total: bigint;
  /** Number of payout events. Drives whether the detail walk is worth it. */
  count: number;
  /** Oldest payout. Needed to know over what period a return was realised. */
  first: RewardEvent | null;
  /** Newest payout. */
  last: RewardEvent | null;
}

/**
 * Lifetime total, count, and the first and last payout — without downloading
 * the payouts.
 *
 * All four in **one** request, via three aliased selections. The endpoint will
 * sum server-side but offers no `min`/`max` over `datetime`, so the date range
 * comes from asking for exactly one row at each end of the block ordering
 * instead. That is what lets "realised return" and "last payout" render from
 * the cheap query rather than waiting on a walk of every event.
 */
export async function fetchRewardTotals(
  stash: string,
  { earnedEra, ...options }: FetchRewardsOptions = {},
): Promise<RewardTotals> {
  const data = await graphql<SummaryResponse>(REWARD_SUMMARY_QUERY, { stash }, options);
  const edge = (nodes: SummaryNode[]) =>
    nodes[0] ? toRewardEvent(nodes[0], earnedEra) : null;

  return {
    total: BigInt(toBaseUnits(data.totals.aggregates?.sum?.amount)),
    count: data.totals.totalCount,
    first: edge(data.first.nodes),
    last: edge(data.last.nodes),
  };
}

/**
 * How many paginated requests a full detail walk would cost.
 *
 * Exposed so the UI can say "1,764 payouts — load the full history?" rather
 * than silently spending two minutes of someone's connection, and so the cost
 * is visible at the call site rather than buried in a loop.
 */
export function pagesFor(count: number): number {
  return Math.ceil(count / INDEXER_PAGE_SIZE);
}

/**
 * Normalises one indexer row.
 *
 * Defensive about types because the endpoint is someone else's: `blockId`
 * arrives as a string, `amount` can be null on a malformed row, and `datetime`
 * is ISO. A row we cannot read becomes a zero rather than a crash — one bad
 * event should not blank an entire reward history.
 */
export function toRewardEvent(
  node: {
    id?: string;
    createdBlockId: string;
    amount: string | number | null;
    datetime: string;
  },
  earnedEra?: ((blockNumber: number) => number | null) | undefined,
): RewardEvent {
  const blockNumber = Number.parseInt(node.createdBlockId, 10);
  const safeBlock = Number.isFinite(blockNumber) ? blockNumber : 0;
  const earned = earnedEra?.(safeBlock) ?? null;

  return {
    earnedEra: earned,
    paidEra: earned == null ? null : earned + 1,
    blockNumber: safeBlock,
    eventIndex: parseEventIndex(node.id),
    datetime: parseIndexerDate(node.datetime),
    amount: toBaseUnits(node.amount),
  };
}

/**
 * The event's position within its block, from the indexer's `blockId/eventIdx`
 * id. Both halves are zero-padded, which is what makes the id sortable.
 */
export function parseEventIndex(id: string | undefined): number {
  const index = Number.parseInt(id?.split('/')[1] ?? '', 10);
  return Number.isFinite(index) ? index : 0;
}

/**
 * Normalises an indexer `amount` to an exact base-unit string.
 *
 * The schema types this as `BigFloat`, not an integer — it arrives as a string
 * like `"1234567"`, sometimes with a `.0` tail, and in principle as a number.
 * The original code demanded `/^\d+$/` and turned anything else into zero,
 * which would have silently reported a lifetime total of 0 POLYX rather than
 * failing.
 *
 * Everything downstream sums in `bigint`, so the string must be exact and
 * integral. A fractional part is discarded rather than rounded: base units are
 * indivisible, so a fraction can only be an artefact of the float encoding, and
 * rounding up could invent a unit that was never paid.
 */
export function toBaseUnits(amount: string | number | null | undefined): string {
  if (amount == null) return '0';

  const text = typeof amount === 'number' ? amount.toFixed(0) : amount.trim();
  // Scientific notation would lose precision through Number; reject it rather
  // than report a wrong figure. Not observed on mainnet, but cheap to guard.
  const match = /^(\d+)(?:\.\d+)?$/.exec(text);
  return match?.[1] ?? '0';
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface RewardSummary {
  /** Exact lifetime total, in base units. */
  total: bigint;
  count: number;
  first: RewardEvent | null;
  last: RewardEvent | null;
}

/** Sums in bigint, so a lifetime total is exact rather than nearly right. */
export function summariseRewards(events: readonly RewardEvent[]): RewardSummary {
  let total = 0n;
  for (const event of events) total += BigInt(event.amount);

  return {
    total,
    count: events.length,
    first: events[0] ?? null,
    last: events.at(-1) ?? null,
  };
}

export interface DailyReward {
  /** Unix seconds, midnight UTC. */
  day: number;
  amount: bigint;
}

const DAY_SECONDS = 86_400;

/**
 * Groups rewards into UTC days for charting.
 *
 * Days rather than eras because a payout is claimed when the user gets round to
 * it, not when it was earned — several eras' rewards commonly land in one
 * transaction. Bucketing by era would attribute all of them to the claim era
 * and draw a spike where there was none.
 *
 * Empty days are filled in, so a gap in claiming renders as a flat line rather
 * than a straight jump between two distant points.
 */
export function rewardsByDay(events: readonly RewardEvent[]): DailyReward[] {
  if (events.length === 0) return [];

  const buckets = new Map<number, bigint>();
  for (const event of events) {
    if (event.datetime === 0) continue;
    const day = Math.floor(event.datetime / DAY_SECONDS) * DAY_SECONDS;
    buckets.set(day, (buckets.get(day) ?? 0n) + BigInt(event.amount));
  }

  const days = [...buckets.keys()].sort((a, b) => a - b);
  const first = days[0];
  const last = days.at(-1);
  if (first == null || last == null) return [];

  const filled: DailyReward[] = [];
  for (let day = first; day <= last; day += DAY_SECONDS) {
    filled.push({ day, amount: buckets.get(day) ?? 0n });
  }
  return filled;
}

/** Running total, for the "what have I earned so far" line. */
export function cumulativeRewards(daily: readonly DailyReward[]): DailyReward[] {
  let running = 0n;
  return daily.map(({ day, amount }) => {
    running += amount;
    return { day, amount: running };
  });
}

/**
 * Realised return over a window, annualised.
 *
 * Deliberately *not* comparable to the APR shown elsewhere without saying so:
 * this divides rewards actually received by the amount currently bonded, and a
 * user who bonded more part-way through will see a figure that looks low. The
 * UI states that; the function returns null rather than guessing when it cannot
 * be computed honestly.
 */
export function realisedApr({
  rewards,
  bonded,
  days,
}: {
  rewards: bigint;
  bonded: bigint;
  days: number;
}): number | null {
  if (bonded <= 0n || days <= 0 || rewards < 0n) return null;
  // Ratio first, in float — the magnitudes here are far inside what a double
  // represents, and the exactness that matters was preserved in the sum.
  const ratio = Number(rewards) / Number(bonded);
  return (ratio * 365) / days;
}

/**
 * CSV of a reward history.
 *
 * Users on a regulated-asset chain need this for reporting, so it carries the
 * block number and the exact base-unit amount alongside the human-readable
 * POLYX — enough to reconcile any row against a block explorer.
 */
export function rewardsToCsv(
  events: readonly RewardEvent[],
  tokenDecimals: number,
  /** Injected so this module stays free of network config. */
  eventUrl?: (blockNumber: number, eventIndex: number) => string,
): string {
  const header = [
    'date_utc',
    // Never a bare `era` column: a payout is made after the era it pays for has
    // closed, so the two differ by one and the unqualified name is ambiguous
    // exactly where it matters most.
    'era_earned',
    'era_paid_in',
    'block',
    'event_index',
    'event_id',
    'amount_polyx',
    'amount_base_units',
    ...(eventUrl ? ['explorer_url'] : []),
  ];
  const divisor = 10 ** tokenDecimals;
  const pad = (value: number) => String(value).padStart(10, '0');

  const lines = events.map((event) =>
    [
      event.datetime > 0 ? new Date(event.datetime * 1000).toISOString() : '',
      // Blank rather than 0 when the era is unknown: this file gets reconciled
      // against block explorers and filed for reporting, so an invented era
      // index is worse than an empty cell.
      event.earnedEra == null ? '' : String(event.earnedEra),
      event.paidEra == null ? '' : String(event.paidEra),
      String(event.blockNumber),
      String(event.eventIndex),
      // The indexer's own id, so a row can be matched back to the source.
      `${pad(event.blockNumber)}/${pad(event.eventIndex)}`,
      (Number(event.amount) / divisor).toFixed(tokenDecimals),
      event.amount,
      ...(eventUrl ? [eventUrl(event.blockNumber, event.eventIndex)] : []),
    ].join(','),
  );

  return [header.join(','), ...lines].join('\n');
}
