/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed storage, as in compat.ts */

import type { ApiLike } from './compat';

/**
 * A stash's current staking position.
 *
 * Read from chain state rather than the indexer, because "how much do I have
 * bonded right now" is a state question and the indexer only knows events.
 *
 * Everything here is exact — balances are `bigint` in base units all the way
 * through — because a user reconciling against their wallet or an explorer will
 * notice a rounding difference immediately, and a staking page that disagrees
 * with the wallet is worse than no staking page.
 */

export interface UnbondingChunk {
  /** Era at which this becomes withdrawable. */
  era: number;
  value: bigint;
}

export interface StashPosition {
  stash: string;
  /** Total bonded, including anything currently unbonding. */
  total: bigint;
  /** Bonded and backing nominations — `total` less the unbonding chunks. */
  active: bigint;
  unbonding: UnbondingChunk[];
  /** Sum of chunks that have already matured and can be withdrawn now. */
  redeemable: bigint;
  /** Where rewards are paid. Null when the chain reports nothing usable. */
  rewardDestination: string | null;
  /** Operators this stash currently nominates. Empty when not nominating. */
  nominations: string[];
  /** Era the nominations were submitted in, if the chain reports it. */
  nominatedAtEra: number | null;
  /** True when the stash has no ledger at all — it has never bonded. */
  isBonded: boolean;
}

const toBigInt = (value: unknown): bigint => {
  try {
    return BigInt(value?.toString() ?? '0');
  } catch {
    return 0n;
  }
};

/**
 * Reads everything `/my-staking` needs about one stash.
 *
 * The controller indirection matters and is easy to get wrong: `staking.ledger`
 * is keyed by *controller*, not stash, so reading it with a stash address
 * returns nothing for most accounts. `staking.bonded(stash)` gives the
 * controller; only then can the ledger be read. Skipping that step is the
 * classic way to show a bonded account as unbonded.
 */
export async function readStashPosition(
  api: ApiLike,
  stash: string,
  activeEra: number,
): Promise<StashPosition> {
  const controllerOption = await api.query.staking.bonded(stash);
  const controller = controllerOption?.isSome ? String(controllerOption.unwrap()) : null;

  const [ledgerOption, payeeRaw, nominatorsOption] = await Promise.all([
    controller ? api.query.staking.ledger(controller) : Promise.resolve(null),
    api.query.staking.payee(stash).catch(() => null),
    api.query.staking.nominators(stash).catch(() => null),
  ]);

  const ledger = ledgerOption?.isSome ? ledgerOption.unwrap() : null;

  const unbonding: UnbondingChunk[] = [];
  let unbondingTotal = 0n;
  let redeemable = 0n;

  for (const chunk of ledger?.unlocking ?? []) {
    const era = Number(chunk.era?.toString() ?? '0');
    const value = toBigInt(chunk.value);
    unbonding.push({ era, value });
    unbondingTotal += value;
    // A chunk unlocks *at* its era, so one whose era has arrived is already
    // withdrawable — `>=`, not `>`. Off by one here understates what a user can
    // take out today.
    if (era <= activeEra) redeemable += value;
  }

  const total = toBigInt(ledger?.total);

  return {
    stash,
    total,
    // From the ledger's own `active` where present rather than by subtraction,
    // since the two can differ transiently around a slash.
    active: ledger?.active != null ? toBigInt(ledger.active) : total - unbondingTotal,
    unbonding: unbonding.sort((a, b) => a.era - b.era),
    redeemable,
    rewardDestination: readPayee(payeeRaw),
    nominations: readNominations(nominatorsOption),
    nominatedAtEra: readSubmittedEra(nominatorsOption),
    isBonded: ledger != null,
  };
}

/**
 * The reward destination, as a readable string.
 *
 * `RewardDestination` is an enum whose `Account` variant carries an address.
 * Rendered as the variant name, or the address for `Account`, because "Staked"
 * versus "Stash" is a distinction users act on: only the first compounds.
 */
function readPayee(payee: any): string | null {
  if (payee == null) return null;
  try {
    if (payee.isAccount) return String(payee.asAccount);
    const type = payee.type ?? payee.toString();
    return typeof type === 'string' && type.length > 0 ? type : null;
  } catch {
    return null;
  }
}

function readNominations(nominators: any): string[] {
  if (nominators == null || !nominators.isSome) return [];
  try {
    return [...nominators.unwrap().targets].map((target: unknown) => String(target));
  } catch {
    return [];
  }
}

function readSubmittedEra(nominators: any): number | null {
  if (nominators == null || !nominators.isSome) return null;
  try {
    const era = nominators.unwrap().submittedIn;
    return era == null ? null : Number(era.toString());
  } catch {
    return null;
  }
}

/**
 * **There is deliberately no `readUnclaimedEras` here**, though §9.6 lists
 * "unclaimed eras, if determinable" as a payouts feature. It is not
 * determinable at acceptable cost or confidence, and the clause allows for it.
 *
 * The obvious implementation — diff the ledger's `claimedRewards` against the
 * history-depth window — is wrong for nominators. That field tracks which
 * *pages* a validator has claimed for itself; a nominator earns only in eras
 * where an operator they backed was elected *and* they landed inside that
 * operator's exposure page. Establishing that means reading exposures for every
 * era in the window against every nomination, which is on the order of a
 * thousand storage reads from a user's browser — precisely the pattern this
 * rebuild exists to remove.
 *
 * Presenting the cheap version would tell people they have unclaimed rewards
 * they do not have. Since signing is out of scope (Q8) there is no action to
 * take on the answer anyway, so the page shows what the indexer can state
 * exactly — every payout actually received, and when the last one landed —
 * and says nothing about what might be owed.
 *
 * Revisit when signing lands: at that point the payout flow needs the real
 * answer, and it should come from the indexer's `Rewarded` events rather than
 * from a storage sweep.
 */
