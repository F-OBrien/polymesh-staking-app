import { describe, expect, it } from 'vitest';
import { idleStake, readEraAllocation, readStakeAllocation } from './allocation';
import type { ApiLike } from './compat';

const STASH = '2Ghq2EKWezZnmdkn2z2bVeDo8GKgegmvrdFoCb45vzobqye8';
const OTHER = '2D65g8EDYWHbKfjvNFWHmXdxBVc5EyssJDc1ciHHE5s4pcPW';

/** A `Vec<IndividualExposure>` page, in the shape polkadot-js hands back. */
const page = (others: { who: string; value: bigint }[]) => ({
  isNone: false,
  unwrap: () => ({
    others: others.map((o) => ({ who: o.who, value: { toString: () => o.value.toString() } })),
  }),
});

const key = (era: number, operator: string, pageIndex: number) => ({
  args: [
    { toString: () => String(era) },
    { toString: () => operator },
    { toString: () => String(pageIndex) },
  ],
});

/**
 * A paged-exposure chain. `pages[era][operator]` is a list of pages, each a
 * list of backers.
 */
function fakeApi(pages: Record<number, Record<string, { who: string; value: bigint }[][]>>): ApiLike {
  return {
    query: {
      staking: {
        activeEra: () =>
          Promise.resolve({ isSome: true, unwrap: () => ({ index: { toString: () => '10' } }) }),
        erasStakersPaged: {
          entries: (era: number, operator: string) =>
            Promise.resolve(
              (pages[era]?.[operator] ?? []).map((backers, i) => [
                key(era, operator, i),
                page(backers),
              ]),
            ),
        },
      },
    },
  } as unknown as ApiLike;
}

describe('readEraAllocation', () => {
  it('finds this stash across an operator’s pages', async () => {
    const api = fakeApi({
      10: {
        alice: [
          [{ who: OTHER, value: 5n }],
          [{ who: STASH, value: 700n }],
        ],
      },
    });

    const result = await readEraAllocation(api, STASH, 10, ['alice']);
    expect(result.assigned).toBe(700n);
    expect(result.targets[0]).toEqual({ address: 'alice', value: 700n, page: 1, elected: true });
  });

  it('reports zero for a nominated operator the election did not use', async () => {
    // The single most surprising fact on the page: nominating an operator does
    // not mean backing it. Phragmén picks a subset.
    const api = fakeApi({
      10: {
        alice: [[{ who: STASH, value: 1000n }]],
        bob: [[{ who: OTHER, value: 50n }]],
      },
    });

    const result = await readEraAllocation(api, STASH, 10, ['alice', 'bob']);
    expect(result.assigned).toBe(1000n);
    expect(result.targets.find((t) => t.address === 'bob')).toEqual({
      address: 'bob',
      value: 0n,
      page: null,
      // Elected — it has exposure — just not backed by *this* stash.
      elected: true,
    });
  });

  it('distinguishes "not elected" from "elected but not backing me"', async () => {
    const api = fakeApi({ 10: { alice: [[{ who: STASH, value: 1n }]] } });
    const result = await readEraAllocation(api, STASH, 10, ['alice', 'missing']);
    expect(result.targets.find((t) => t.address === 'missing')?.elected).toBe(false);
  });

  it('sums across pages if a stash ever appears on more than one', async () => {
    const api = fakeApi({
      10: {
        alice: [
          [{ who: STASH, value: 100n }],
          [{ who: STASH, value: 200n }],
        ],
      },
    });
    expect((await readEraAllocation(api, STASH, 10, ['alice'])).assigned).toBe(300n);
  });

  it('survives one unreadable operator rather than blanking the position', async () => {
    const api = {
      query: {
        staking: {
          erasStakersPaged: {
            entries: (_era: number, operator: string) =>
              operator === 'broken'
                ? Promise.reject(new Error('decode failed'))
                : Promise.resolve([[key(10, operator, 0), page([{ who: STASH, value: 42n }])]]),
          },
        },
      },
    } as unknown as ApiLike;

    const result = await readEraAllocation(api, STASH, 10, ['alice', 'broken']);
    expect(result.assigned).toBe(42n);
    expect(result.targets.find((t) => t.address === 'broken')?.elected).toBe(false);
  });
});

describe('readStakeAllocation', () => {
  it('reads the current era and the one whose rewards are being paid', async () => {
    // Rewards for era N land during era N+1, so "why did I earn nothing?" is
    // usually answered by the previous era, not the current one.
    const api = fakeApi({
      10: { alice: [[{ who: STASH, value: 500n }]] },
      9: { alice: [[{ who: OTHER, value: 500n }]] },
    });

    const result = await readStakeAllocation(api, STASH, 10, ['alice']);
    expect(result.current.assigned).toBe(500n);
    expect(result.previous?.era).toBe(9);
    expect(result.previous?.assigned).toBe(0n);
  });

  it('does not read a previous era at genesis', async () => {
    const api = {
      query: {
        staking: {
          activeEra: () =>
            Promise.resolve({ isSome: true, unwrap: () => ({ index: { toString: () => '0' } }) }),
          erasStakersPaged: {
            entries: () => Promise.resolve([[key(0, 'alice', 0), page([{ who: STASH, value: 1n }])]]),
          },
        },
      },
    } as unknown as ApiLike;
    expect((await readStakeAllocation(api, STASH, 0, ['alice'])).previous).toBeNull();
  });

  it('takes the era from the chain, not the snapshot it is handed', async () => {
    // `latest.json` lags the chain by up to fifteen minutes, and exposure is
    // keyed by era. Trusting the snapshot across an era boundary read the wrong
    // era's exposure and reported a fully-assigned stash as assigned nothing.
    const api = fakeApi({
      10: { alice: [[{ who: STASH, value: 999n }]] },
      9: { alice: [[{ who: STASH, value: 111n }]] },
    });
    // Chain says 10 (see `fakeApi`); the caller passes a stale 9.
    const result = await readStakeAllocation(api, STASH, 9, ['alice']);
    expect(result.current.era).toBe(10);
    expect(result.current.assigned).toBe(999n);
  });

  it('falls back to the snapshot era when the chain will not say', async () => {
    const api = {
      query: {
        staking: {
          activeEra: () => Promise.reject(new Error('unavailable')),
          erasStakersPaged: {
            entries: (era: number) =>
              Promise.resolve(
                era === 7 ? [[key(7, 'alice', 0), page([{ who: STASH, value: 5n }])]] : [],
              ),
          },
        },
      },
    } as unknown as ApiLike;
    const result = await readStakeAllocation(api, STASH, 7, ['alice']);
    expect(result.current.era).toBe(7);
    expect(result.current.assigned).toBe(5n);
  });

  it('does no reads at all when nothing is nominated', async () => {
    const api = {
      query: {
        staking: {
          activeEra: () =>
            Promise.resolve({ isSome: true, unwrap: () => ({ index: { toString: () => '10' } }) }),
          erasStakersPaged: {
            entries: () => Promise.reject(new Error('should not be called')),
          },
        },
      },
    } as unknown as ApiLike;

    const result = await readStakeAllocation(api, STASH, 10, []);
    expect(result.current.assigned).toBe(0n);
    expect(result.previous).toBeNull();
  });
});

describe('idleStake', () => {
  it('reports the part of an active bond the election left out', () => {
    expect(idleStake(1000n, 600n)).toBe(400n);
  });

  it('never goes negative', () => {
    // Exposure is snapshotted at the election; unbonding since then lowers the
    // active bond without changing it, so assigned can legitimately exceed it.
    expect(idleStake(500n, 900n)).toBe(0n);
  });
});
