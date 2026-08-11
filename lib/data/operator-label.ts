import { truncateAddress } from '@/lib/format';
import type { OperatorRegistry } from '@/lib/schemas/data';

/**
 * Display labels for operators, disambiguated by address only where needed.
 *
 * Several nodes commonly run under one identity — DigiClear and Entoro each run
 * three on mainnet — and they share a name, because the registry gives them one.
 * A chart legend reading "DigiClear" three times is useless, and §8.1 rule 5
 * forbids leaning on colour to tell series apart.
 *
 * The obvious fix is what this replaces: numbering them "DigiClear 1", "2", "3"
 * by their position in a sort of that identity's addresses. Nothing on chain
 * carries that number — it was ours — and it is **not stable**. Adding a stash
 * that sorts earlier renumbers every node after it, so a "DigiClear 2" noted
 * today can be a different node tomorrow, silently.
 *
 * So the disambiguator is the address, which is what actually identifies a
 * node and cannot drift. It is appended *only* where a name is shared, so the
 * common case stays clean:
 *
 *     Assetera                       — the only node under that name
 *     DigiClear (2HW34b…sNz3Dz)      — one of three
 *
 * Ambiguity is judged against the whole registry rather than whatever happens
 * to be on screen, so a label does not change as a filter or selection changes.
 */
export type OperatorLabeller = (address: string) => string;

export function buildLabeller(registry: OperatorRegistry | undefined): OperatorLabeller {
  if (!registry) return (address) => truncateAddress(address);

  const counts = new Map<string, number>();
  for (const record of Object.values(registry)) {
    counts.set(record.name, (counts.get(record.name) ?? 0) + 1);
  }

  return (address) => {
    const record = registry[address];
    if (!record) return truncateAddress(address);
    return (counts.get(record.name) ?? 0) > 1
      ? `${record.name} (${truncateAddress(address)})`
      : record.name;
  };
}
