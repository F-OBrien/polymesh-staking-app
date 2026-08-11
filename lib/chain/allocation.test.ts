import { describe, expect, it } from 'vitest';
import { idleStake, readEraAllocation, readStakeAllocation } from './allocation';
import type { ApiLike } from './compat';

const STASH = '2Ghq2EKWezZnmdkn2z2bVeDo8GKgegmvrdFoCb45vzobqye8';
const OTHER = '2D65g8EDYWHbKfjvNFWHmXdxBVc5EyssJDc1ciHHE5s4pcPW';

/** `(era, validator, page)` — the key shape polkadot-js yields from entries(). */
const key = (era: number, operator: string, pageIndex: number) => ({
  args: [
    { toString: () => String(era) },
    { toString: () => operator },
    { toString: () => String(pageIndex) },
  ],
});

const page = (others: { who: string; value: bigint }[]) => ({
  isNone: false,
  unwrap: () => ({
    others: others.map((o) => ({ who: o.who, value: { toString: () => o.value.toString() } })),
  }),
});

type Era = Record<string, { who: string; value: bigint }[][]>;

/**
 * A chain whose exposure is read by *whole-era* prefix scan.
 *
 * `entries(era)` takes no validator argument — which is the point. The reader
 * must not depend on being told which operators to look at, because the
 * nomination list is exactly what can be wrong.
 */
function fakeApi(
  eras: Record<number, Era>,
  activeEra = 10,
  selfStake: Record<string, number> = {},
): ApiLike {
  return {
    query: {
      staking: {
        activeEra: () =>
          Promise.resolve({
            isSome: true,
            unwrap: () => ({ index: { toString: () => String(activeEra) } }),
          }),
        erasStakersPaged: {
          entries: (era: number) =>
            Promise.resolve(
              Object.entries(eras[era] ?? {}).flatMap(([operator, pages]) =>
                pages.map((backers, i) => [key(era, operator, i), page(backers)]),
              ),
            ),
        },
        erasStakersOverview: {
          entries: (era: number) =>
            Promise.resolve(
              Object.keys(eras[era] ?? {}).map((operator) => [
                key(era, operator, 0),
                { own: { toString: () => String(selfStake[operator] ?? 0) } },
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
      10: { alice: [[{ who: OTHER, value: 5n }], [{ who: STASH, value: 700n }]] },
    });

    const result = await readEraAllocation(api, STASH, 10, ['alice']);
    expect(result.assigned).toBe(700n);
    expect(result.targets[0]).toEqual({
      address: 'alice',
      value: 700n,
      page: 1,
      elected: true,
      nominated: true,
    });
  });

  it('reports zero for a nominated operator the election did not use', async () => {
    // Phragmén picks a subset of a nominator's targets, so nominating an
    // operator does not mean backing it.
    const api = fakeApi({
      10: { alice: [[{ who: STASH, value: 1000n }]], bob: [[{ who: OTHER, value: 50n }]] },
    });

    const result = await readEraAllocation(api, STASH, 10, ['alice', 'bob']);
    expect(result.assigned).toBe(1000n);
    expect(result.targets.find((t) => t.address === 'bob')).toEqual({
      address: 'bob',
      value: 0n,
      page: null,
      elected: true,
      nominated: true,
    });
  });

  it('finds stake held by an operator that is NO LONGER nominated', async () => {
    // The bug this whole-era scan exists for. Nominations can change at any
    // moment; exposure is fixed at the election. Re-nominate mid-era and the
    // stake stays with the operator just dropped. A reader that iterates the
    // nomination list cannot see it, and reports a normally-earning position
    // as "nothing assigned" — at exactly the moment someone is most likely to
    // be looking, having just changed who they back.
    const api = fakeApi({
      10: {
        oldOperator: [[{ who: STASH, value: 2000n }]],
        newOperator: [[{ who: OTHER, value: 9n }]],
      },
    });

    // The stash now nominates only `newOperator`.
    const result = await readEraAllocation(api, STASH, 10, ['newOperator']);

    expect(result.assigned).toBe(2000n);
    expect(result.unnominated).toBe(2000n);

    expect(result.targets.find((t) => t.address === 'oldOperator')).toEqual({
      address: 'oldOperator',
      value: 2000n,
      page: 0,
      elected: true,
      nominated: false,
    });
  });

  it('lists nominations first, then anything else holding stake', async () => {
    const api = fakeApi({
      10: { dropped: [[{ who: STASH, value: 1n }]], kept: [[{ who: STASH, value: 2n }]] },
    });
    const result = await readEraAllocation(api, STASH, 10, ['kept']);
    expect(result.targets.map((t) => t.address)).toEqual(['kept', 'dropped']);
  });

  it('finds stake for a stash that has chilled entirely', async () => {
    // Withdrawing every nomination does not withdraw stake from the current
    // era's exposure — it keeps earning until the next election.
    const api = fakeApi({ 10: { alice: [[{ who: STASH, value: 500n }]] } });
    const result = await readEraAllocation(api, STASH, 10, []);
    expect(result.assigned).toBe(500n);
    expect(result.unnominated).toBe(500n);
  });

  it('distinguishes "not elected" from "elected but not backing me"', async () => {
    const api = fakeApi({ 10: { alice: [[{ who: STASH, value: 1n }]] } });
    const result = await readEraAllocation(api, STASH, 10, ['alice', 'missing']);
    expect(result.targets.find((t) => t.address === 'missing')?.elected).toBe(false);
  });

  it('sums across pages if a stash ever appears on more than one', async () => {
    const api = fakeApi({
      10: { alice: [[{ who: STASH, value: 100n }], [{ who: STASH, value: 200n }]] },
    });
    expect((await readEraAllocation(api, STASH, 10, ['alice'])).assigned).toBe(300n);
  });
});

describe('readStakeAllocation', () => {
  it('reads the current era and the one whose rewards are being paid', async () => {
    const api = fakeApi({
      10: { alice: [[{ who: STASH, value: 500n }]] },
      9: { alice: [[{ who: OTHER, value: 500n }]] },
    });

    const result = await readStakeAllocation(api, STASH, 10, ['alice']);
    expect(result.current.assigned).toBe(500n);
    expect(result.previous?.era).toBe(9);
    expect(result.previous?.assigned).toBe(0n);
  });

  it('takes the era from the chain, not the snapshot it is handed', async () => {
    // `latest.json` lags the chain by up to fifteen minutes, and exposure is
    // keyed by era. Trusting the snapshot across a boundary read the wrong
    // era's exposure and reported a fully-assigned stash as assigned nothing.
    const api = fakeApi({
      10: { alice: [[{ who: STASH, value: 999n }]] },
      9: { alice: [[{ who: STASH, value: 111n }]] },
    });
    const result = await readStakeAllocation(api, STASH, 9, ['alice']);
    expect(result.current.era).toBe(10);
    expect(result.current.assigned).toBe(999n);
  });

  it('does not read a previous era at genesis', async () => {
    const api = fakeApi({ 0: { alice: [[{ who: STASH, value: 1n }]] } }, 0);
    expect((await readStakeAllocation(api, STASH, 0, ['alice'])).previous).toBeNull();
  });

  it('still reads exposure when nothing is nominated', async () => {
    // No shortcut on an empty nomination list: a chilled stash is still exposed
    // for the current era, and skipping the read would report it as gone.
    const api = fakeApi({ 10: { alice: [[{ who: STASH, value: 77n }]] } });
    const result = await readStakeAllocation(api, STASH, 10, []);
    expect(result.current.assigned).toBe(77n);
  });
});

describe('an operator viewing their own stash', () => {
  it('counts self-stake, which lives in `own` and not in `others`', async () => {
    // A validator does not appear in its own `others` list — that holds its
    // nominators. Scanning only `others` reported an operator's fully-exposed
    // bond as idle: the same class of wrong answer as the nomination-list bug,
    // for a different group of users.
    const api = fakeApi({ 10: { alice: [[{ who: OTHER, value: 50n }]] } }, 10, { alice: 900 });
    const result = await readEraAllocation(api, 'alice', 10, []);

    expect(result.own).toBe(900n);
    expect(result.assigned).toBe(900n);
  });

  it('keeps self-stake out of the un-nominated total', async () => {
    // Own stake is not "sitting with an operator you dropped"; it is yours.
    const api = fakeApi({ 10: { alice: [[{ who: OTHER, value: 1n }]] } }, 10, { alice: 500 });
    expect((await readEraAllocation(api, 'alice', 10, [])).unnominated).toBe(0n);
  });

  it('reports zero own stake for a plain nominator', async () => {
    const api = fakeApi({ 10: { alice: [[{ who: STASH, value: 10n }]] } }, 10, { alice: 900 });
    expect((await readEraAllocation(api, STASH, 10, ['alice'])).own).toBe(0n);
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
