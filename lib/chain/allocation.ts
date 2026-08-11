/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed storage, as in compat.ts */

import type { ApiLike } from './compat';

/**
 * Where a nominator's stake actually went, for a given era.
 *
 * This is the gap between what `/my-staking` used to show and what is true.
 * "Bonded" is a number the user chose; **assigned** is what the election did
 * with it, and the two differ in three ways that all matter:
 *
 *  1. **The election picks a subset of your targets.** Phragmén optimises the
 *     network's stake distribution, not yours, so nominating eight operators
 *     very often means backing one or two of them. Measured on a real mainnet
 *     stash: 2,019,000 POLYX nominating eight elected operators, with the whole
 *     amount assigned to a single one. Anyone reading the nomination list would
 *     reasonably believe they were diversified across eight. They were not.
 *  2. **A new nomination does not take effect until the next election.** The
 *     same stash was assigned nothing at all in the previous era, because it
 *     nominated during it.
 *  3. **Rewards for era N are paid during era N+1.** So the exposure that earned
 *     the payout landing today is the *previous* era's, which is why both are
 *     read here. "Why did I earn nothing?" is usually answered by the previous
 *     era's allocation being zero, not by anything wrong today.
 *
 * Cost is one prefix scan per nomination per era. `erasStakersPaged` is keyed
 * `(era, validator, page)`, so a partial key returns every page of an operator's
 * exposure in a single read — nominations are capped at 16, so this is bounded
 * and it only ever runs for the address a user explicitly asked about.
 */

export interface TargetAllocation {
  /** The nominated operator. */
  address: string;
  /** This stash's stake backing that operator this era, in base units. */
  value: bigint;
  /** Exposure page it landed on, or null when not backing this operator. */
  page: number | null;
  /** Whether the operator was in the active set at all this era. */
  elected: boolean;
}

export interface EraAllocation {
  era: number;
  /** Sum of `targets[].value` — what the election actually put to work. */
  assigned: bigint;
  targets: TargetAllocation[];
}

const toBigInt = (value: unknown): bigint => {
  try {
    return BigInt(value?.toString() ?? '0');
  } catch {
    return 0n;
  }
};

/**
 * One operator's exposure for an era, as `(nominator, value)` pairs.
 *
 * Handles both shapes: v8's paged exposures and the pre-v8 `erasStakersClipped`.
 * Only the current and previous era are ever read here, so in practice this is
 * always the paged path on mainnet today — the fallback exists so the function
 * does not throw against an older runtime rather than because it is expected.
 */
async function readOperatorBackers(
  api: ApiLike,
  era: number,
  operator: string,
): Promise<{ backers: { who: string; value: bigint; page: number }[]; present: boolean }> {
  if ('erasStakersPaged' in api.query.staking) {
    const pages: any[] = await api.query.staking.erasStakersPaged.entries(era, operator);
    const backers: { who: string; value: bigint; page: number }[] = [];

    for (const [key, page] of pages) {
      if (page.isNone) continue;
      const pageIndex = Number(key.args[2]?.toString() ?? '0');
      for (const other of page.unwrap().others) {
        backers.push({ who: String(other.who), value: toBigInt(other.value), page: pageIndex });
      }
    }
    return { backers, present: pages.length > 0 };
  }

  const clipped: any = await api.query.staking.erasStakersClipped(era, operator);
  const others = clipped?.others ?? [];
  return {
    backers: others.map((other: any) => ({
      who: String(other.who),
      value: toBigInt(other.value),
      page: 0,
    })),
    // Pre-v8 storage returns a zeroed struct rather than an Option, so
    // "elected" is inferred from there being any exposure at all.
    present: toBigInt(clipped?.total) > 0n,
  };
}

/** How this stash's stake was allocated across its nominations, for one era. */
export async function readEraAllocation(
  api: ApiLike,
  stash: string,
  era: number,
  targets: readonly string[],
): Promise<EraAllocation> {
  // Parallel across targets: each is an independent prefix read, and a
  // nominator has at most sixteen.
  const results = await Promise.all(
    targets.map(async (address): Promise<TargetAllocation> => {
      try {
        const { backers, present } = await readOperatorBackers(api, era, address);

        let value = 0n;
        let page: number | null = null;
        for (const backer of backers) {
          if (backer.who !== stash) continue;
          // A stash appears on exactly one page, but summing rather than
          // assigning keeps this correct if that ever stops being true.
          value += backer.value;
          page = backer.page;
        }

        return { address, value, page, elected: present };
      } catch {
        // One unreadable operator must not blank the whole allocation. It
        // reports as "not backing", which is also what a caller should show
        // when the chain will not say.
        return { address, value: 0n, page: null, elected: false };
      }
    }),
  );

  return {
    era,
    assigned: results.reduce((sum, target) => sum + target.value, 0n),
    targets: results,
  };
}

export interface StakeAllocation {
  /** The era now running — what the stake is doing right now. */
  current: EraAllocation;
  /**
   * The era before it — the one whose rewards are being paid out now.
   *
   * Null when there is no previous era to read. Kept separate rather than
   * merged, because "what am I earning on today" and "what is today's payout
   * for" are different questions with different answers.
   */
  previous: EraAllocation | null;
}

/**
 * Reads the active era **from the chain**, not from the snapshot.
 *
 * This is a tier mismatch that produced a genuinely wrong answer. `latest.json`
 * is regenerated every fifteen minutes, so its `activeEra` lags the chain
 * across an era boundary — and exposure is keyed by era. Using the snapshot's
 * number here read the *previous* era's exposure and reported a stash with
 * 2,019,000 POLYX assigned as having nothing at all.
 *
 * Anything read over the socket should ask the socket what era it is. The
 * snapshot's era is right for snapshot-derived figures and wrong for these.
 */
async function readActiveEra(api: ApiLike): Promise<number | null> {
  try {
    const active: any = await api.query.staking.activeEra();
    if (active?.isSome !== true) return null;
    return Number(active.unwrap().index.toString());
  } catch {
    return null;
  }
}

export async function readStakeAllocation(
  api: ApiLike,
  stash: string,
  /** Fallback only, for when the chain will not say. */
  snapshotEra: number,
  targets: readonly string[],
): Promise<StakeAllocation> {
  const era = (await readActiveEra(api)) ?? snapshotEra;

  if (targets.length === 0) {
    return { current: { era, assigned: 0n, targets: [] }, previous: null };
  }

  const [current, previous] = await Promise.all([
    readEraAllocation(api, stash, era, targets),
    era > 0 ? readEraAllocation(api, stash, era - 1, targets) : Promise.resolve(null),
  ]);

  return { current, previous };
}

/**
 * The part of an active bond the election did not put to work.
 *
 * Never negative: assigned stake can exceed the current ledger balance
 * transiently — the exposure was snapshotted at the election, and an unbond
 * since then lowers `active` without changing this era's exposure. Reporting a
 * negative "idle" figure would be nonsense, so it clamps.
 */
export function idleStake(active: bigint, assigned: bigint): bigint {
  const idle = active - assigned;
  return idle > 0n ? idle : 0n;
}
