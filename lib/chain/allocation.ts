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
  /** The operator. */
  address: string;
  /** This stash's stake backing that operator this era, in base units. */
  value: bigint;
  /** Exposure page it landed on, or null when not backing this operator. */
  page: number | null;
  /** Whether the operator was in the active set at all this era. */
  elected: boolean;
  /**
   * Whether the stash *currently* nominates this operator.
   *
   * False means the stash is exposed to an operator it has since dropped. That
   * is not an error and not stale data — see `readEraAllocation`.
   */
  nominated: boolean;
}

export interface EraAllocation {
  era: number;
  /** Sum of `targets[].value` — what the election actually put to work. */
  assigned: bigint;
  /** Stake sitting with operators the stash no longer nominates. */
  unnominated: bigint;
  targets: TargetAllocation[];
}

const toBigInt = (value: unknown): bigint => {
  try {
    return BigInt(value?.toString() ?? '0');
  } catch {
    return 0n;
  }
};

interface Backing {
  operator: string;
  value: bigint;
  page: number;
}

/**
 * Every operator this stash is exposed to in an era, found by searching the
 * whole era's exposure rather than by consulting the nomination list.
 *
 * **This is the correctness point of the module.** Nominations can be changed
 * at any moment; exposure is fixed at the election. Re-nominate mid-era and
 * your stake stays with the operator you just dropped — who is no longer in
 * `staking.nominators(stash).targets`. Iterating the nomination list therefore
 * cannot find your own stake, and reports a normally-earning position as
 * "nothing assigned". That was a real bug here, and it would have shown its
 * worst answer at exactly the moment someone is most likely to look: just
 * after changing who they back.
 *
 * `erasStakersPaged.entries(era)` is a single prefix read over every operator
 * and page, so it cannot miss anything. Measured on mainnet: **one RPC call,
 * ~425ms, 74 KB, 2,034 nominator edges across 86 operators** — against sixteen
 * calls and ~356ms for the per-nomination version it replaces. Fewer round
 * trips, and no way to be wrong.
 *
 * The design doc (§2.1) rightly calls this the heaviest query available, but
 * that warning is about the previous app issuing it *85 times on every page
 * load*. Twice, on demand, for the address a user explicitly asked about, is a
 * different thing entirely.
 */
async function readEraBacking(api: ApiLike, stash: string, era: number): Promise<Backing[]> {
  const backing: Backing[] = [];

  if ('erasStakersPaged' in api.query.staking) {
    const pages: any[] = await api.query.staking.erasStakersPaged.entries(era);

    for (const [key, page] of pages) {
      if (page.isNone) continue;
      for (const other of page.unwrap().others) {
        if (String(other.who) !== stash) continue;
        backing.push({
          operator: String(key.args[1]),
          value: toBigInt(other.value),
          page: Number(key.args[2]?.toString() ?? '0'),
        });
      }
    }
    return backing;
  }

  // Pre-v8 shape. Only reached against an old runtime; mainnet is paged.
  const entries: any[] = await api.query.staking.erasStakersClipped.entries(era);
  for (const [key, exposure] of entries) {
    for (const other of exposure?.others ?? []) {
      if (String(other.who) !== stash) continue;
      backing.push({ operator: String(key.args[1]), value: toBigInt(other.value), page: 0 });
    }
  }
  return backing;
}

/** Which operators were in the active set for an era. */
async function readElected(api: ApiLike, era: number): Promise<Set<string>> {
  try {
    const overviews: any[] = await api.query.staking.erasStakersOverview.entries(era);
    return new Set(overviews.map(([key]) => String(key.args[1])));
  } catch {
    return new Set();
  }
}

/**
 * How this stash's stake was allocated for one era.
 *
 * The returned list is the **union** of what the stash nominates and what it is
 * actually exposed to. Those two sets can differ in both directions, and each
 * difference means something a reader needs told:
 *
 *  - nominated but not backed — the election chose other targets, or the
 *    nomination post-dates the election;
 *  - backed but not nominated — the nomination was changed after the election,
 *    and the stake stays put until the next one.
 */
export async function readEraAllocation(
  api: ApiLike,
  stash: string,
  era: number,
  targets: readonly string[],
): Promise<EraAllocation> {
  const [backing, elected] = await Promise.all([
    readEraBacking(api, stash, era),
    readElected(api, era),
  ]);

  const byOperator = new Map<string, { value: bigint; page: number }>();
  for (const entry of backing) {
    const existing = byOperator.get(entry.operator);
    // A stash appears on exactly one page per operator, but summing rather
    // than assigning keeps this correct if that ever stops being true.
    byOperator.set(entry.operator, {
      value: (existing?.value ?? 0n) + entry.value,
      page: entry.page,
    });
  }

  const nominatedSet = new Set(targets);
  // Nominations first and in their own order, then anything else holding stake.
  const addresses = [...targets, ...[...byOperator.keys()].filter((a) => !nominatedSet.has(a))];

  const allocations: TargetAllocation[] = addresses.map((address) => {
    const held = byOperator.get(address);
    return {
      address,
      value: held?.value ?? 0n,
      page: held?.page ?? null,
      elected: elected.has(address),
      nominated: nominatedSet.has(address),
    };
  });

  return {
    era,
    assigned: allocations.reduce((sum, a) => sum + a.value, 0n),
    unnominated: allocations.reduce((sum, a) => (a.nominated ? sum : sum + a.value), 0n),
    targets: allocations,
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

  // Note there is no `targets.length === 0` shortcut. A stash that has chilled
  // — withdrawn its nominations entirely — still has exposure for the current
  // era and is still earning from it. Skipping the read for an empty
  // nomination list would report that stake as gone.

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
