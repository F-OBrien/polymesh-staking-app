/**
 * Does exposure paging actually cost a nominator anything on Polymesh?
 *
 * The site used to badge operators with more than `maxExposurePageSize`
 * nominators as "full", warning that new nominators "may earn nothing". That is
 * the pre-paged-exposure rule, and it is wrong here on two counts:
 *
 *   1. Paged exposures reward *every* page. `pallets/validators/src/tests.rs`
 *      has a test named `test_nominators_over_max_exposure_page_size_are_rewarded`.
 *   2. Polymesh pays out automatically. `validators::payouts()` walks
 *      `PendingPayouts` for `CurrentPayoutEra`, page by page, on chain — so the
 *      nominator does not even depend on someone calling `payout_stakers`.
 *
 * This probe checks (2) against the live chain, because a claim about what a
 * nominator earns must not rest on reading the source alone. Point 1 is a
 * property of the runtime's own test suite.
 */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main(): Promise<void> {
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });
  try {
    const v: any = api.query.validators;
    if (v == null) {
      console.log('no `validators` pallet — this runtime predates the v8 split');
      return;
    }

    console.log('validators pallet storage:', Object.keys(v).join(', '));

    const maxPageSize = (api.consts.staking as any)?.maxExposurePageSize;
    console.log('\nstaking.maxExposurePageSize =', maxPageSize?.toString() ?? '(absent)');

    const activeEra: any = await api.query.staking.activeEra();
    const era = activeEra.isSome ? Number(activeEra.unwrap().index.toString()) : null;
    console.log('activeEra                   =', era);

    // The automatic payout cursor. If this tracks the era, payouts are being
    // driven by the chain rather than by whoever remembers to call for them.
    const payoutEra: any = await v.currentPayoutEra?.();
    console.log('validators.currentPayoutEra =', payoutEra?.toString() ?? '(absent)');

    const pending: any = await v.pendingPayouts?.entries?.();
    if (pending != null) {
      console.log('validators.pendingPayouts   =', pending.length, 'era(s) queued');
      for (const [key, value] of pending.slice(0, 3)) {
        console.log(`  era ${key.args[0].toString()}: ${(value as any).length} validator(s) left`);
      }
    }

    // The decisive check: an operator with more than one page, and whether the
    // chain recorded every page as claimed for a completed era.
    if (era != null && maxPageSize != null) {
      const limit = Number(maxPageSize.toString());
      const overview: any = await api.query.staking.erasStakersOverview.entries(era - 1);
      const paged = overview
        .map(([key, value]: [any, any]) => ({
          address: String(key.args[1]),
          pageCount: Number(value.unwrap().pageCount.toString()),
          nominatorCount: Number(value.unwrap().nominatorCount.toString()),
        }))
        .filter((o: any) => o.pageCount > 1)
        .sort((a: any, b: any) => b.pageCount - a.pageCount);

      console.log(`\nera ${era - 1}: ${paged.length} operator(s) with more than one page`);
      for (const o of paged.slice(0, 5)) {
        const claimed: any = await api.query.staking.claimedRewards(era - 1, o.address);
        const pages: number[] = claimed.toJSON() as number[];
        const all = pages.length === o.pageCount;
        console.log(
          `  ${o.address.slice(0, 10)}… ${o.nominatorCount} nominators / ${o.pageCount} pages ` +
            `(limit ${limit}) — claimed pages [${pages.join(',')}] ${all ? '✓ all paid' : '✗ INCOMPLETE'}`,
        );
      }
    }
  } finally {
    await disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
