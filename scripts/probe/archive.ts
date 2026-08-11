/**
 * Can we actually read pruned era storage from the public RPC?
 *
 * The design doc (§6.5) records "the public RPCs are archive nodes" as verified
 * but undocumented, and everything about deep-history backfill rests on it. An
 * undocumented guarantee can be withdrawn without notice, so this re-checks it
 * before any backfill run — and checks the thing that actually matters, which is
 * not "does `api.at()` work" but "does era storage *at that block* still decode".
 *
 * Era boundaries come from the indexer rather than a binary search over
 * `staking.activeEra`: `staking.EraPayout` (eras 0-1120) and `staking.EraPaid`
 * (1121-) between them record every era transition with its block, so one
 * paginated pass gets all 1,749 of them.
 *
 * Run with `npm run probe:archive`.
 */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl, resolveIndexerUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface EraAnchor {
  era: number;
  block: number;
  datetime: string;
}

/** Era -> the block its transition was recorded in, for a few sample eras. */
async function eraAnchors(eras: readonly number[]): Promise<EraAnchor[]> {
  const query = `
    query($eras: [String!]) {
      events(
        filter: {
          moduleId: { equalTo: staking }
          eventId: { in: [EraPaid, EraPayout] }
          eventArg0: { in: $eras }
        }
        first: 100
      ) {
        nodes { eventArg0 blockId block { datetime } }
      }
    }
  `;

  const response = await fetch(resolveIndexerUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { eras: eras.map(String) } }),
  });
  const body: any = await response.json();
  if (body.errors) throw new Error(body.errors.map((e: any) => e.message).join('; '));

  return body.data.events.nodes.map((node: any) => ({
    era: Number(node.eventArg0),
    block: Number(node.blockId),
    datetime: node.block?.datetime ?? '?',
  }));
}

async function main(): Promise<void> {
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });

  try {
    const activeEra: any = await api.query.staking.activeEra();
    const current = Number(activeEra.unwrap().index.toString());
    const depth = Number((await api.query.staking.historyDepth?.())?.toString() ?? 84);
    console.log(`active era ${current}, history depth ${depth}`);
    console.log(`eras still in current state: ${current - depth} .. ${current}\n`);

    // One recent (should work from current state anyway) and several long
    // pruned — including era 0, which is the real question for backfill.
    const wanted = [0, 100, 500, 1000, 1500, current - depth - 5];
    const anchors = (await eraAnchors(wanted)).sort((a, b) => a.era - b.era);
    console.log(`indexer returned ${anchors.length} era anchors\n`);

    for (const anchor of anchors) {
      const pruned = anchor.era < current - depth;
      const label = `era ${String(anchor.era).padStart(4)} @ block ${anchor.block} (${anchor.datetime})${pruned ? ' [pruned from current state]' : ''}`;

      try {
        // Read one block *after* the transition, so the era's storage is
        // definitely written by the time we look.
        const hash = await api.rpc.chain.getBlockHash(anchor.block);
        const at: any = await api.at(hash);

        const points: any = await at.query.staking.erasRewardPoints(anchor.era);
        const reward: any = await at.query.staking.erasValidatorReward(anchor.era);
        const total: any = await at.query.staking.erasTotalStake(anchor.era);
        const prefs: any = await at.query.staking.erasValidatorPrefs.entries(anchor.era);

        const spec = at.runtimeVersion.specVersion.toString();
        const totalPoints = Number(points.total?.toString() ?? 0);
        const operators = points.individual?.size ?? 0;

        // v6/v7 used clipped exposures; v8 paged. Which one answers tells the
        // backfill which shape to decode.
        const shape = at.query.staking.erasStakersOverview
          ? 'paged (overview available)'
          : 'clipped';

        console.log(`✓ ${label}`);
        console.log(
          `    spec ${spec} · ${totalPoints.toLocaleString()} points across ${operators} operators · ` +
            `${prefs.length} prefs · reward ${reward.isSome ? reward.unwrap().toString() : 'none'} · ` +
            `staked ${total.toString()} · exposures ${shape}`,
        );
      } catch (error) {
        console.log(`✗ ${label}\n    ${(error as Error).message.slice(0, 200)}`);
      }
    }
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
