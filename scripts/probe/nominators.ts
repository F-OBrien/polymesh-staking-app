/**
 * Find a real nominator, for verifying `/my-staking` against something other
 * than a validator's own stash.
 *
 * `npm run probe:nominators`
 */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main(): Promise<void> {
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });
  try {
    const entries: any[] = await (api.query.staking as any).nominators.entries();
    const rows = entries
      .map(([key, value]: any) => ({
        who: key.args[0].toString(),
        targets: value.unwrap().targets.length,
      }))
      .sort((a, b) => b.targets - a.targets);

    console.log(`${entries.length} nominators on chain`);
    for (const row of rows.slice(0, 8)) console.log(`  ${row.who}  ${row.targets} targets`);
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
