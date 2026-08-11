/**
 * Checks `readStashPosition` against real chain state.
 *
 * The risky part is the controller indirection: `staking.ledger` is keyed by
 * *controller*, not stash, so reading it with a stash address returns nothing
 * for most accounts — and "nothing" decodes as "not bonded" rather than as an
 * error. This proves the two-step read actually resolves.
 *
 *   npx tsx scripts/probe/stash.ts [address]
 */
import { readFileSync } from 'node:fs';
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';
import { readActiveEra } from '../../lib/chain/compat';
import { readStashPosition } from '../../lib/chain/stash';

async function main(): Promise<void> {
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });
  try {
    const activeEra = await readActiveEra(api);
    const registry = JSON.parse(readFileSync('public/data/operators.json', 'utf8'));

    // Operators are guaranteed to be bonded, so they exercise the happy path.
    const candidates = process.argv[2] ? [process.argv[2]] : Object.keys(registry).slice(0, 3);

    for (const stash of candidates) {
      const p = await readStashPosition(api, stash, activeEra.index);
      const label = registry[stash]?.name ?? '(not an operator)';
      console.log(`\n${stash}  ${label}`);
      console.log('  isBonded       :', p.isBonded);
      console.log('  total / active :', fmt(p.total), '/', fmt(p.active), 'POLYX');
      console.log(
        '  unbonding      :',
        p.unbonding.length,
        'chunk(s), redeemable',
        fmt(p.redeemable),
      );
      console.log('  rewardDest     :', p.rewardDestination);
      console.log(
        '  nominations    :',
        p.nominations.length,
        p.nominations.length ? `(era ${p.nominatedAtEra})` : '',
      );
    }

    // A nominator, to exercise the other branch: find one from a nominator map entry.
    const nominators = await api.query.staking.nominators.entries();
    console.log(`\nnominator accounts on chain: ${nominators.length}`);
    const first = nominators[0];
    if (first) {
      const addr = String(first[0].args[0]);
      const p = await readStashPosition(api, addr, activeEra.index);
      console.log(`\n${addr}  (nominator)`);
      console.log('  isBonded       :', p.isBonded);
      console.log('  total / active :', fmt(p.total), '/', fmt(p.active), 'POLYX');
      console.log('  rewardDest     :', p.rewardDestination);
      console.log('  nominations    :', p.nominations.length, `(era ${p.nominatedAtEra})`);
      console.log(
        '  unbonding      :',
        p.unbonding.map((c) => `era ${c.era}: ${fmt(c.value)}`).join(', ') || 'none',
      );
    }
  } finally {
    await disconnect();
  }
}

const fmt = (v: bigint) =>
  (Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
