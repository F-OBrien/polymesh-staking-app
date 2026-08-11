/**
 * What is a nominator's stake actually doing this era?
 *
 * `/my-staking` shows what is bonded. It does not show how that bond was
 * *allocated* by the election, and the two are not the same number:
 *
 *  - Stake bonded after the last election is not in this era's exposure at all.
 *  - The election picks which of a nominator's targets their stake backs, and
 *    can split it across several — or none, if no target was elected.
 *  - Rewards for era N are paid during era N+1, so the exposure that earned
 *    them is the previous era's, not the one on screen.
 *
 * This probe establishes what is readable and at what cost, before any of it
 * reaches the UI. Run with `npm run probe:allocation -- <stash>`.
 */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */

const POLYX = (value: bigint) => (Number(value) / 1e6).toLocaleString(undefined, {
  maximumFractionDigits: 2,
});

async function main(): Promise<void> {
  const stash = process.argv[2];
  if (!stash) {
    console.error('Usage: npm run probe:allocation -- <stash address>');
    process.exitCode = 1;
    return;
  }

  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });

  try {
    const activeEraRaw: any = await api.query.staking.activeEra();
    const era = Number(activeEraRaw.unwrap().index.toString());

    const controllerOption: any = await api.query.staking.bonded(stash);
    if (!controllerOption?.isSome) {
      console.log('Not bonded.');
      return;
    }
    const ledger: any = await api.query.staking.ledger(String(controllerOption.unwrap()));
    const active = BigInt(ledger.unwrap().active.toString());
    const total = BigInt(ledger.unwrap().total.toString());

    const nominatorsOption: any = await api.query.staking.nominators(stash);
    const targets: string[] = nominatorsOption.isSome
      ? [...nominatorsOption.unwrap().targets].map(String)
      : [];
    const submittedIn = nominatorsOption.isSome
      ? Number(nominatorsOption.unwrap().submittedIn.toString())
      : null;

    console.log(`stash        ${stash}`);
    console.log(`active era   ${era}`);
    console.log(`bonded       ${POLYX(total)} POLYX total, ${POLYX(active)} active`);
    console.log(`nominations  ${targets.length} target(s), submitted in era ${submittedIn}`);
    console.log('');

    // One prefix scan per target: `erasStakersPaged` is keyed
    // (era, validator, page), so a partial key gets every page in one read.
    let reads = 0;
    let assigned = 0n;
    const rows: { target: string; value: bigint; page: number; elected: boolean }[] = [];

    for (const target of targets) {
      const pages: any[] = await api.query.staking.erasStakersPaged.entries(era, target);
      reads += 1;

      let found = 0n;
      let onPage = -1;
      for (const [key, page] of pages) {
        if (page.isNone) continue;
        for (const other of page.unwrap().others) {
          if (String(other.who) === stash) {
            found += BigInt(other.value.toString());
            onPage = Number(key.args[2].toString());
          }
        }
      }

      assigned += found;
      rows.push({ target, value: found, page: onPage, elected: pages.length > 0 });
    }

    console.log(`read ${reads} prefix scan(s), one per nomination\n`);
    console.log('target                    elected  page   assigned this era');
    for (const row of rows) {
      console.log(
        `${row.target.slice(0, 24)}  ${row.elected ? 'yes    ' : 'no     '}  ` +
          `${row.page < 0 ? '  -' : String(row.page).padStart(3)}   ` +
          `${row.value === 0n ? '—' : `${POLYX(row.value)} POLYX`}`,
      );
    }

    console.log('');
    console.log(`assigned this era  ${POLYX(assigned)} POLYX`);
    console.log(`active bond        ${POLYX(active)} POLYX`);
    const gap = active - assigned;
    console.log(
      `difference         ${POLYX(gap)} POLYX` +
        (gap > 0n ? '  <- bonded but not backing anything this era' : ''),
    );

    // The era that is actually being paid out right now.
    const previous = era - 1;
    let previousAssigned = 0n;
    for (const target of targets) {
      const pages: any[] = await api.query.staking.erasStakersPaged.entries(previous, target);
      for (const [, page] of pages) {
        if (page.isNone) continue;
        for (const other of page.unwrap().others) {
          if (String(other.who) === stash) previousAssigned += BigInt(other.value.toString());
        }
      }
    }
    console.log(
      `\nassigned in era ${previous} (the one being paid out now): ${POLYX(previousAssigned)} POLYX`,
    );
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
