/**
 * How expensive is it to find a stash's exposure *without* trusting the
 * nomination list?
 *
 * The bug this exists to price: nominations can be changed at any time, but
 * exposure is fixed at the election. Re-nominate mid-era and your stake stays
 * assigned to the operator you just dropped — who is no longer in
 * `staking.nominators(stash).targets`. A reader that iterates the nomination
 * list therefore cannot see its own stake, and reports "none assigned" for a
 * position that is earning normally.
 *
 * The only way to be certain is to search every operator's exposure for the
 * era. `erasStakersPaged.entries(era)` does that in one prefix read — but §2.1
 * of the design doc calls this "the single heaviest thing you can ask a
 * Substrate node for", so it must be measured before it goes anywhere near a
 * user's browser.
 *
 * Compares it against the per-nomination reads it would replace.
 *
 * `npm run probe:exposure-scan`
 */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main(): Promise<void> {
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });

  try {
    const activeEra: any = await api.query.staking.activeEra();
    const era = Number(activeEra.unwrap().index.toString());
    console.log(`active era ${era}\n`);

    // --- The whole-era scan: one prefix read, every operator, every page. ----
    const t0 = Date.now();
    const pages: any[] = await api.query.staking.erasStakersPaged.entries(era);
    const scanMs = Date.now() - t0;

    let edges = 0;
    let bytes = 0;
    const operators = new Set<string>();
    for (const [key, page] of pages) {
      operators.add(String(key.args[1]));
      bytes += page.encodedLength ?? 0;
      if (page.isNone) continue;
      edges += page.unwrap().others.length;
    }

    console.log('whole-era scan  erasStakersPaged.entries(era)');
    console.log(`  1 RPC call · ${scanMs}ms`);
    console.log(`  ${pages.length} pages across ${operators.size} operators`);
    console.log(`  ${edges} nominator edges`);
    console.log(`  ${(bytes / 1024).toFixed(1)} KB SCALE-encoded`);

    // --- The per-nomination reads it replaces. ------------------------------
    const sample = [...operators].slice(0, 16);
    const t1 = Date.now();
    await Promise.all(sample.map((op) => api.query.staking.erasStakersPaged.entries(era, op)));
    const perNomMs = Date.now() - t1;

    console.log(`\nper-nomination  erasStakersPaged.entries(era, validator) x ${sample.length}`);
    console.log(`  ${sample.length} RPC calls · ${perNomMs}ms (issued in parallel)`);

    console.log(
      `\nverdict: the whole-era scan is ${scanMs < perNomMs ? 'FASTER' : 'slower'} and always ` +
        `correct, at ${(bytes / 1024).toFixed(0)} KB for the era.`,
    );

    // --- How many nominators would actually be affected by the bug? ---------
    // A stash whose exposure sits with an operator it no longer nominates.
    const exposedTo = new Map<string, string[]>();
    for (const [key, page] of pages) {
      if (page.isNone) continue;
      const operator = String(key.args[1]);
      for (const other of page.unwrap().others) {
        const who = String(other.who);
        exposedTo.set(who, [...(exposedTo.get(who) ?? []), operator]);
      }
    }

    console.log(`\n${exposedTo.size} distinct nominators exposed this era.`);
    console.log('checking a sample for exposure outside their current nominations…');

    let checked = 0;
    let stale = 0;
    for (const [who, backing] of [...exposedTo.entries()].slice(0, 40)) {
      const nominatorsOption: any = await api.query.staking.nominators(who);
      const targets: string[] = nominatorsOption?.isSome
        ? [...nominatorsOption.unwrap().targets].map(String)
        : [];
      checked += 1;

      const orphaned = backing.filter((operator) => !targets.includes(operator));
      if (orphaned.length > 0) {
        stale += 1;
        if (stale <= 5) {
          console.log(
            `  ${who.slice(0, 12)}… exposed to ${orphaned.length} operator(s) it no longer ` +
              `nominates (nominates ${targets.length})`,
          );
        }
      }
    }
    console.log(
      `\n${stale} of ${checked} sampled nominators have exposure outside their nomination list.`,
    );
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
