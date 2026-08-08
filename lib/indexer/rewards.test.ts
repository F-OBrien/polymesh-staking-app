import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, graphql, IndexerError, INDEXER_PAGE_SIZE } from './client';
import {
  cumulativeRewards,
  fetchRewards,
  realisedApr,
  rewardsByDay,
  rewardsToCsv,
  summariseRewards,
  toRewardEvent,
  type RewardEvent,
} from './rewards';

const DAY = 86_400;

const event = (overrides: Partial<RewardEvent> = {}): RewardEvent => ({
  era: 1,
  blockNumber: 100,
  datetime: DAY * 100,
  amount: '1000000',
  ...overrides,
});

/** A fetch stub returning a GraphQL envelope. */
const jsonFetch = (payload: unknown, init: { ok?: boolean; status?: number } = {}) =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
      ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => payload,
      }) as unknown as Response,
  );

describe('graphql', () => {
  it('throws on a GraphQL error even though the status is 200', async () => {
    // The trap this guards: GraphQL answers 200 with an `errors` array, so
    // checking response.ok alone would surface a schema error as "no rewards",
    // which is the worst possible misreading on a page about someone's money.
    const fetchImpl = jsonFetch({ errors: [{ message: 'Unknown field "stashAccount"' }] });
    await expect(graphql('{}', {}, { fetchImpl, endpoint: 'http://x' })).rejects.toThrow(
      IndexerError,
    );
  });

  it('surfaces the underlying GraphQL message as detail', async () => {
    const fetchImpl = jsonFetch({ errors: [{ message: 'boom' }] });
    await expect(graphql('{}', {}, { fetchImpl, endpoint: 'http://x' })).rejects.toMatchObject({
      detail: 'boom',
    });
  });

  it('throws when data is absent without an error array', async () => {
    const fetchImpl = jsonFetch({});
    await expect(graphql('{}', {}, { fetchImpl, endpoint: 'http://x' })).rejects.toThrow(
      /no data/i,
    );
  });

  it('calls out rate limiting specifically', async () => {
    const fetchImpl = jsonFetch({}, { ok: false, status: 429 });
    await expect(graphql('{}', {}, { fetchImpl, endpoint: 'http://x' })).rejects.toMatchObject({
      detail: expect.stringContaining('rate-limited'),
    });
  });

  it('wraps a network failure rather than leaking it', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(graphql('{}', {}, { fetchImpl, endpoint: 'http://x' })).rejects.toThrow(
      IndexerError,
    );
  });

  it('rethrows an abort untouched, so a cancelled query is not an error state', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(
      graphql('{}', {}, { fetchImpl, endpoint: 'http://x', signal: controller.signal }),
    ).rejects.not.toBeInstanceOf(IndexerError);
  });

  it('returns data on success', async () => {
    const fetchImpl = jsonFetch({ data: { ok: 1 } });
    await expect(graphql('{}', {}, { fetchImpl, endpoint: 'http://x' })).resolves.toEqual({
      ok: 1,
    });
  });
});

describe('fetchAllPages', () => {
  it('walks pages until hasNextPage is false', async () => {
    const pages = [
      { nodes: [1, 2], hasNextPage: true },
      { nodes: [3], hasNextPage: false },
    ];
    const offsets: number[] = [];
    const result = await fetchAllPages<number>(async (offset) => {
      offsets.push(offset);
      return pages[offsets.length - 1]!;
    });

    expect(result.nodes).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
    expect(offsets).toEqual([0, INDEXER_PAGE_SIZE]);
  });

  it('handles more than one page of 100, which is the endpoint cap', async () => {
    const total = 250;
    const result = await fetchAllPages<number>(async (offset) => {
      const nodes = Array.from(
        { length: Math.max(0, Math.min(INDEXER_PAGE_SIZE, total - offset)) },
        (_, i) => offset + i,
      );
      return { nodes, hasNextPage: offset + nodes.length < total };
    });

    expect(result.nodes).toHaveLength(250);
    expect(result.truncated).toBe(false);
  });

  it('stops on an empty page even if the indexer claims there is more', async () => {
    // Otherwise a misbehaving endpoint spins to the page cap for nothing.
    let calls = 0;
    const result = await fetchAllPages<number>(async () => {
      calls += 1;
      return { nodes: [], hasNextPage: true };
    });
    expect(calls).toBe(1);
    expect(result.nodes).toEqual([]);
  });

  it('flags truncation instead of throwing when the cap is reached', async () => {
    const result = await fetchAllPages<number>(async () => ({ nodes: [1], hasNextPage: true }));
    expect(result.truncated).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('requests pages sequentially, not in parallel', async () => {
    // The rate limit is undocumented and this runs in a user's browser.
    let inFlight = 0;
    let maxInFlight = 0;
    let remaining = 3;

    await fetchAllPages<number>(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      remaining -= 1;
      return { nodes: [1], hasNextPage: remaining > 0 };
    });

    expect(maxInFlight).toBe(1);
  });
});

describe('toRewardEvent', () => {
  it('parses a well-formed row', () => {
    const result = toRewardEvent({
      blockNumber: 0,
      blockId: '12345',
      amount: '5000000',
      datetime: '2026-08-08T12:00:00.000Z',
    } as never);
    expect(result.blockNumber).toBe(12345);
    expect(result.amount).toBe('5000000');
    expect(result.datetime).toBe(Math.floor(Date.parse('2026-08-08T12:00:00.000Z') / 1000));
  });

  it('maps a block to an era when a mapper is supplied', () => {
    const result = toRewardEvent(
      { blockId: '900', amount: '1', datetime: '2026-01-01T00:00:00Z' },
      (block) => Math.floor(block / 100),
    );
    expect(result.era).toBe(9);
  });

  it('survives a null amount rather than blanking the whole history', () => {
    const result = toRewardEvent({ blockId: '1', amount: null, datetime: '2026-01-01T00:00:00Z' });
    expect(result.amount).toBe('0');
  });

  it('rejects a non-integer amount, which would break the bigint sum', () => {
    const result = toRewardEvent({
      blockId: '1',
      amount: '12.5',
      datetime: '2026-01-01T00:00:00Z',
    });
    expect(result.amount).toBe('0');
    expect(() => BigInt(result.amount)).not.toThrow();
  });

  it('survives an unparseable block or date', () => {
    const result = toRewardEvent({ blockId: 'abc', amount: '1', datetime: 'not a date' });
    expect(result.blockNumber).toBe(0);
    expect(result.datetime).toBe(0);
  });
});

describe('fetchRewards', () => {
  it('paginates and normalises', async () => {
    const page = (offset: number, hasNextPage: boolean) => ({
      data: {
        stakingEvents: {
          nodes: [
            {
              id: 'a',
              blockId: String(offset + 1),
              eventId: 'Rewarded',
              amount: '1000000',
              datetime: '2026-01-01T00:00:00Z',
              stashAccount: 's',
              identityId: null,
            },
          ],
          pageInfo: { hasNextPage },
        },
      },
    });

    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return {
        ok: true,
        status: 200,
        json: async () => page(call === 1 ? 0 : 100, call === 1),
      } as unknown as Response;
    });

    const { events, truncated } = await fetchRewards('stash', {
      fetchImpl,
      endpoint: 'http://x',
    });

    expect(events).toHaveLength(2);
    expect(truncated).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends the stash and page size as variables', async () => {
    const fetchImpl = jsonFetch({
      data: { stakingEvents: { nodes: [], pageInfo: { hasNextPage: false } } },
    });
    await fetchRewards('5Stash', { fetchImpl, endpoint: 'http://x' });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.variables).toEqual({ stash: '5Stash', first: 100, offset: 0 });
    expect(body.query).toContain('Rewarded');
  });
});

describe('summariseRewards', () => {
  it('sums exactly in bigint', () => {
    // Beyond Number.MAX_SAFE_INTEGER, which a lifetime of rewards can reach.
    const events = [event({ amount: '9007199254740993' }), event({ amount: '1' })];
    expect(summariseRewards(events).total).toBe(9007199254740994n);
  });

  it('reports first and last', () => {
    const events = [event({ blockNumber: 1 }), event({ blockNumber: 9 })];
    const summary = summariseRewards(events);
    expect(summary.first?.blockNumber).toBe(1);
    expect(summary.last?.blockNumber).toBe(9);
    expect(summary.count).toBe(2);
  });

  it('handles an empty history', () => {
    expect(summariseRewards([])).toEqual({ total: 0n, count: 0, first: null, last: null });
  });
});

describe('rewardsByDay', () => {
  it('buckets by UTC day and sums within a day', () => {
    const day = DAY * 100;
    const daily = rewardsByDay([
      event({ datetime: day + 3600, amount: '100' }),
      event({ datetime: day + 7200, amount: '150' }),
    ]);
    expect(daily).toEqual([{ day, amount: 250n }]);
  });

  it('fills empty days so a claiming gap is flat, not a straight jump', () => {
    const daily = rewardsByDay([
      event({ datetime: DAY * 10, amount: '100' }),
      event({ datetime: DAY * 13, amount: '200' }),
    ]);
    expect(daily.map((d) => d.day)).toEqual([DAY * 10, DAY * 11, DAY * 12, DAY * 13]);
    expect(daily.map((d) => d.amount)).toEqual([100n, 0n, 0n, 200n]);
  });

  it('skips rows with an unreadable date rather than bucketing them at epoch', () => {
    // A single bad row would otherwise stretch the axis back to 1970.
    const daily = rewardsByDay([
      event({ datetime: 0 }),
      event({ datetime: DAY * 10, amount: '5' }),
    ]);
    expect(daily).toEqual([{ day: DAY * 10, amount: 5n }]);
  });

  it('returns nothing for an empty history', () => {
    expect(rewardsByDay([])).toEqual([]);
  });
});

describe('cumulativeRewards', () => {
  it('accumulates', () => {
    const daily = [
      { day: 1, amount: 10n },
      { day: 2, amount: 0n },
      { day: 3, amount: 5n },
    ];
    expect(cumulativeRewards(daily).map((d) => d.amount)).toEqual([10n, 10n, 15n]);
  });
});

describe('realisedApr', () => {
  it('annualises a part-year return', () => {
    // 5% over 73 days ≈ 25% annualised.
    expect(realisedApr({ rewards: 500n, bonded: 10_000n, days: 73 })).toBeCloseTo(0.25, 6);
  });

  it('returns null rather than dividing by zero bonded', () => {
    expect(realisedApr({ rewards: 100n, bonded: 0n, days: 30 })).toBeNull();
  });

  it('returns null for a zero-length window', () => {
    expect(realisedApr({ rewards: 100n, bonded: 1000n, days: 0 })).toBeNull();
  });
});

describe('rewardsToCsv', () => {
  it('keeps the exact base-unit amount alongside the readable one', () => {
    // Reconciliation against a block explorer is the point; a rounded POLYX
    // figure alone cannot be checked.
    const csv = rewardsToCsv([event({ amount: '1234567', era: 42, blockNumber: 99 })], 6);
    const [header, row] = csv.split('\n');
    expect(header).toBe('date_utc,era,block,amount_polyx,amount_base_units');
    expect(row).toContain('1.234567');
    expect(row).toContain('1234567');
    expect(row).toContain(',42,99,');
  });

  it('emits a header even with no rows', () => {
    expect(rewardsToCsv([], 6).split('\n')).toHaveLength(1);
  });

  it('leaves the date blank rather than printing 1970 for an unreadable row', () => {
    const csv = rewardsToCsv([event({ datetime: 0 })], 6);
    expect(csv.split('\n')[1]!.startsWith(',')).toBe(true);
  });
});
