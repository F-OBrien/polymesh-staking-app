/**
 * Operator identity registry.
 *
 * Replaces the previous app's hand-maintained map of ~100 stash addresses to
 * display names, which went stale the moment an operator rebranded (its history
 * contains commits titled "Rename Tigerwit to Calico Capital" and an entry
 * literally labelled "Marketlend 1 (old)").
 *
 * Names come from the registry the Polymesh Association maintains and the
 * official Portal uses. It is keyed by **DID**, while everything in staking is
 * keyed by **stash address**, so the join runs through on-chain identity:
 *
 *     stash -> DID (chain) -> name (registry) -> truncated address (fallback)
 *
 * The pipeline resolves this and bakes the result into `operators.json`, so the
 * client makes no extra request and we hold a snapshot if the upstream file
 * ever moves or disappears.
 */

import {
  UpstreamOperatorNamesSchema,
  type OperatorRecord,
  type OperatorRegistry,
} from '../../lib/schemas/data';
import { readIdentityForAccount, readValidatorSet, type ApiLike } from '../../lib/chain/compat';
import type { DataStore } from './store';

const UPSTREAM_REGISTRY_URL =
  'https://raw.githubusercontent.com/PolymeshAssociation/polymesh-operators/refs/heads/main/operatorNames.json';

/** Shortens an SS58 address for display when no name is known. */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

/**
 * Fetches the upstream DID -> name map.
 *
 * Returns null on any failure. A naming service being down must never fail an
 * ingestion run — the caller falls back to the previous registry, and stale
 * names are vastly preferable to no data.
 */
async function fetchUpstreamNames(): Promise<Map<string, string> | null> {
  try {
    const response = await fetch(UPSTREAM_REGISTRY_URL, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.warn(`Operator registry returned ${response.status}; keeping existing names.`);
      return null;
    }

    const parsed = UpstreamOperatorNamesSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn(`Operator registry failed validation; keeping existing names.`);
      return null;
    }

    return new Map(
      Object.entries(parsed.data).map(([did, entry]) => [did.toLowerCase(), entry.name]),
    );
  } catch (error) {
    console.warn(`Could not fetch operator registry: ${String(error)}. Keeping existing names.`);
    return null;
  }
}

/**
 * Numbers the nodes belonging to one identity: "Assetera 1", "Assetera 2".
 *
 * Most Polymesh operators run three nodes under a single DID, so without this
 * every chart legend would show the same name three times. Ordering is by
 * address so the numbering is stable across runs — otherwise a node could
 * silently swap labels between ingests.
 */
export interface BuildRegistryOptions {
  api: ApiLike;
  store: DataStore;
  /** Stash addresses seen in the eras just ingested. */
  seenAddresses: ReadonlySet<string>;
  firstEra: number;
  lastEra: number;
}

/**
 * Builds the registry, merging newly seen operators into whatever is on disk.
 *
 * Merging rather than rebuilding preserves `firstSeenEra` for operators outside
 * the eras just ingested — a value that cannot be recovered once lost, since
 * older eras eventually age out of the chain's state.
 */
export async function buildOperatorRegistry({
  api,
  store,
  seenAddresses,
  firstEra,
  lastEra,
}: BuildRegistryOptions): Promise<OperatorRegistry> {
  const existing = (await store.readOperators()) ?? {};
  const upstreamNames = await fetchUpstreamNames();

  // Only resolve identities we do not already know: this is one RPC call per
  // address, and re-resolving ~100 stashes every hour would be wasteful when
  // the mapping effectively never changes.
  const addressesToResolve = [...seenAddresses].filter((address) => existing[address]?.did == null);

  const didByAddress = new Map<string, string | null>(
    Object.entries(existing).map(([address, record]) => [address, record.did]),
  );

  for (const address of addressesToResolve) {
    try {
      didByAddress.set(address, await readIdentityForAccount(api, address));
    } catch {
      // An operator with no resolvable identity is normal, not an error.
      didByAddress.set(address, null);
    }
  }

  // Group by DID so sibling nodes can be numbered together.
  const addressesByDid = new Map<string, string[]>();
  for (const address of seenAddresses) {
    const did = didByAddress.get(address);
    if (did == null) continue;
    const key = did.toLowerCase();
    addressesByDid.set(key, [...(addressesByDid.get(key) ?? []), address]);
  }

  const nameForDid = (did: string): string =>
    upstreamNames?.get(did) ??
    // Fall back to a previously-resolved name before giving up on the address.
    Object.values(existing).find((r) => r.did?.toLowerCase() === did)?.name ??
    truncateAddress(addressesByDid.get(did)?.[0] ?? did);

  const { active, waiting } = await readValidatorSet(api);
  const activeSet = new Set(active);
  const waitingSet = new Set(waiting);

  const registry: OperatorRegistry = { ...existing };

  for (const address of seenAddresses) {
    const previous = existing[address];
    const did = didByAddress.get(address) ?? null;
    const name = did == null ? truncateAddress(address) : nameForDid(did.toLowerCase());

    const record: OperatorRecord = {
      did,
      name,
      website: previous?.website ?? null,
      firstSeenEra: Math.min(previous?.firstSeenEra ?? firstEra, firstEra),
      lastSeenEra: Math.max(previous?.lastSeenEra ?? lastEra, lastEra),
      status: activeSet.has(address) ? 'active' : waitingSet.has(address) ? 'waiting' : 'inactive',
    };

    registry[address] = record;
  }

  // Operators absent from this run keep their history but lose active status —
  // otherwise a departed operator would show as active forever.
  for (const [address, record] of Object.entries(registry)) {
    if (!seenAddresses.has(address) && record.status !== 'inactive') {
      registry[address] = {
        ...record,
        status: activeSet.has(address)
          ? 'active'
          : waitingSet.has(address)
            ? 'waiting'
            : 'inactive',
      };
    }
  }

  return registry;
}
