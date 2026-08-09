/** What Polymesh's slashing switch is actually set to. */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main(): Promise<void> {
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });
  try {
    const v: any = api.query.validators ?? api.query.staking;
    const names = Object.keys(v ?? {}).filter((k) => /slash/i.test(k));
    console.log('slash-related storage on validators/staking:', names.join(', ') || '(none)');
    for (const n of names) {
      try {
        const val = await v[n]();
        console.log(`  ${n} =`, val?.toString());
      } catch {
        console.log(`  ${n} = <needs key>`);
      }
    }
    console.log(
      '\nall `validators` pallet storage:',
      Object.keys(api.query.validators ?? {}).join(', '),
    );
  } finally {
    await disconnect();
  }
}
main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
