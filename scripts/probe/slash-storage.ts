/**
 * One-off probe: does the chain actually expose the slash storage we read?
 *
 * `readEraSlashes` returns an empty array when the storage item is absent, so
 * "no offences" and "we are reading the wrong map" produce identical output.
 * This tells the two apart by asking for every key in the map at once.
 */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main(): Promise<void> {
  const network = resolveNetwork();
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(network) });
  try {
    const s: any = api.query.staking;
    console.log('spec version                :', api.runtimeVersion.specVersion.toString());
    console.log(
      'validatorSlashInEra present :',
      typeof s.validatorSlashInEra?.entries === 'function',
    );
    console.log(
      'nominatorSlashInEra present :',
      typeof s.nominatorSlashInEra?.entries === 'function',
    );
    console.log('unappliedSlashes present    :', typeof s.unappliedSlashes?.entries === 'function');

    const all = await s.validatorSlashInEra.entries();
    console.log('validatorSlashInEra entries :', all.length, '(all eras)');
    for (const [k, v] of all.slice(0, 5)) {
      console.log(
        '   era',
        k.args[0].toString(),
        String(k.args[1]).slice(0, 12) + '…',
        '->',
        v.toString(),
      );
    }

    const nom = await s.nominatorSlashInEra.entries();
    console.log('nominatorSlashInEra entries :', nom.length, '(all eras)');

    const un = await s.unappliedSlashes.entries();
    console.log(
      'unappliedSlashes non-empty  :',
      un.filter(([, v]: any) => v.length > 0).length,
      'era(s)',
    );
    console.log('slashRewardFraction         :', (await s.slashRewardFraction()).toString());
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
