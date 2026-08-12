/**
 * Was a given operator actually in a given era, according to the chain?
 *
 * For settling "the chart shows data here but the operator was not running"
 * without trusting `public/data`, which is exactly what would be wrong if a
 * backfill had written a value into an era the operator was absent from.
 *
 * `npm run probe:era-operator -- <address> <fromEra> <toEra>`
 */
import { connect, apiAt } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';
import { readEraExposures, readEraRewardPoints } from '../../lib/chain/compat';
import { DataStore } from '../ingest/store';
import { blockForEra } from '../ingest/era-build';
import { join } from 'node:path';

async function main(): Promise<void> {
  const [address, from, to] = process.argv.slice(2);
  if (!address) throw new Error('usage: probe:era-operator -- <address> <fromEra> [toEra]');

  const store = new DataStore(join(process.cwd(), 'public', 'data'));
  const index = await store.readEraIndex();
  if (!index) throw new Error('era-index.json missing');

  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });
  try {
    const first = Number(from);
    const last = Number(to ?? from);
    for (let era = first; era <= last; era += 1) {
      const block = blockForEra(index, era);
      if (block == null) {
        console.log(`era ${era}: no block in index`);
        continue;
      }
      const hash = (await api.rpc.chain.getBlockHash(block)).toString();
      const at = await apiAt(api, hash);
      const [points, exposures] = await Promise.all([
        readEraRewardPoints(at, era),
        readEraExposures(at, era),
      ]);
      const scored = points.operators.get(address);
      const exposed = exposures.exposures.find((e) => e.address === address);
      console.log(
        `era ${era} @ ${block}: points=${scored ?? 'ABSENT'} exposure=${
          exposed ? exposed.total.toString() : 'ABSENT'
        } (set size ${exposures.exposures.length})`,
      );
    }
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
