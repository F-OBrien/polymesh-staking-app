/**
 * Checks the reward query in `lib/indexer/rewards.ts` against the live schema.
 *
 * Written because that query was authored blind, with no chain egress, and the
 * first real run found three bugs — two of which fail *silently*: ordering by a
 * String block id sorts lexicographically, and filtering on `Rewarded` alone
 * misses the 30% of events recorded under the older `Reward` spelling.
 *
 * Worth re-running after any runtime upgrade, since a renamed enum member or
 * field would break history retrieval without breaking the query.
 *
 *   npx tsx scripts/probe/indexer.ts
 */
import { resolveIndexerUrl, resolveNetwork } from '../../config/networks';
import { fetchRewards } from '../../lib/indexer/rewards';
import { IndexerError } from '../../lib/indexer/client';
import { readFileSync } from 'node:fs';

async function main(): Promise<void> {
  const endpoint = resolveIndexerUrl(resolveNetwork());
  console.log('indexer:', endpoint, '\n');

  // Introspect first: a mismatch in field names is far easier to read here than
  // in a rejected query.
  const introspect = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `{ __type(name: "StakingEvent") { fields { name type { name kind ofType { name } } } } }`,
    }),
  });
  const meta = await introspect.json();
  const fields = meta?.data?.__type?.fields;
  if (!fields) {
    console.log('StakingEvent type not found. Raw:', JSON.stringify(meta).slice(0, 400));
  } else {
    console.log('StakingEvent fields:');
    for (const f of fields) {
      const t = f.type?.name ?? f.type?.ofType?.name ?? f.type?.kind;
      console.log('  ', f.name.padEnd(24), t);
    }
  }

  // Now the real query, against an operator stash (operators earn rewards too).
  const registry = JSON.parse(readFileSync('public/data/operators.json', 'utf8'));
  const stash = Object.keys(registry)[0]!;
  console.log('\nquerying stash:', stash, `(${registry[stash].name})`);

  const { events, truncated } = await fetchRewards(stash, { endpoint });
  console.log('events        :', events.length, '| truncated:', truncated);
  for (const e of events.slice(0, 3)) console.log('   ', JSON.stringify(e));
  if (events.length > 0) {
    const total = events.reduce((s, e) => s + BigInt(e.amount), 0n);
    console.log('lifetime total:', (Number(total) / 1e6).toFixed(2), 'POLYX');
    console.log('last          :', new Date(events.at(-1)!.datetime * 1000).toISOString());
  }
}

main().catch((error: unknown) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  // `IndexerError.detail` carries the GraphQL message, which is the part that
  // actually says which field was wrong.
  if (error instanceof IndexerError && error.detail) console.error('detail:', error.detail);
  process.exitCode = 1;
});
