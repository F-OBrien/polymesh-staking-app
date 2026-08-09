import {
  fetchAllPages,
  graphql,
  INDEXER_PAGE_SIZE,
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
   * The era this reward was for, or `null` when it cannot be established.
   *
   * Null is the normal case, not an edge case. The indexer records a block, not
   * an era, and the block→era mapping only exists for eras we still hold chunks
   * for — about 84 of them, against reward histories that run for years. An
   * earlier revision defaulted this to `0`, which exported as a confident "era
   * 0" in a CSV people use for tax reporting.
   */
  era: number | null;
  blockNumber: number;
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
 *  - **Ordering is by `DATETIME_ASC`, not `CREATED_BLOCK_ID_ASC`.** The block id
 *    is a *String*, so ordering by it sorts lexicographically: block "10" sorts
 *    before block "9", and a reward history would come back subtly shuffled with
 *    no error at all. Datetime is the honest key here anyway, since the UI
 *    buckets by day.
 *  - **`eventId` must match both `Reward` and `Rewarded`.** Polymesh renamed the
 *    event across a runtime upgrade and the enum carries both spellings.
 *    Filtering on `Rewarded` alone returns only recent history and silently
 *    reports a lifetime total that is missing its early years — the worst kind
 *    of wrong, because it looks entirely plausible.
 */
const REWARDS_QUERY = `
  query RewardsForStash($stash: String!, $first: Int!, $offset: Int!) {
    stakingEvents(
      filter: {
        stashAccount: { equalTo: $stash }
        eventId: { in: [Reward, Rewarded] }
      }
      orderBy: [DATETIME_ASC]
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
   * Maps a block number to the era it fell in. Reward events carry a block,
   * not an era, and the mapping lives in our own manifest — so it is injected
   * rather than guessed, and rows outside known history get era 0.
   */
  eraForBlock?: ((blockNumber: number) => number) | undefined;
}

/**
 * Every `Rewarded` event for a stash, oldest first.
 *
 * Returns `truncated` when the page cap was reached, so the UI can say the
 * history is partial rather than quietly showing a wrong lifetime total.
 */
export async function fetchRewards(
  stash: string,
  { eraForBlock, ...options }: FetchRewardsOptions = {},
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
  return { events: nodes.map((node) => toRewardEvent(node, eraForBlock)), truncated };
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
    createdBlockId: string;
    amount: string | number | null;
    datetime: string;
  },
  eraForBlock?: ((blockNumber: number) => number) | undefined,
): RewardEvent {
  const blockNumber = Number.parseInt(node.createdBlockId, 10);
  const safeBlock = Number.isFinite(blockNumber) ? blockNumber : 0;
  const parsed = Date.parse(node.datetime);

  return {
    era: eraForBlock?.(safeBlock) ?? null,
    blockNumber: safeBlock,
    datetime: Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0,
    amount: toBaseUnits(node.amount),
  };
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
export function rewardsToCsv(events: readonly RewardEvent[], tokenDecimals: number): string {
  const header = ['date_utc', 'era', 'block', 'amount_polyx', 'amount_base_units'];
  const divisor = 10 ** tokenDecimals;

  const lines = events.map((event) =>
    [
      event.datetime > 0 ? new Date(event.datetime * 1000).toISOString() : '',
      // Blank rather than 0 when the era is unknown: this file gets reconciled
      // against block explorers and filed for reporting, so an invented era
      // index is worse than an empty cell.
      event.era == null ? '' : String(event.era),
      String(event.blockNumber),
      (Number(event.amount) / divisor).toFixed(tokenDecimals),
      event.amount,
    ].join(','),
  );

  return [header.join(','), ...lines].join('\n');
}
