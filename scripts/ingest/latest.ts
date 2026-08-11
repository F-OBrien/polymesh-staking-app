/**
 * Active-era snapshot.
 *
 * Runs every 15 minutes and writes only `latest.json`. Cheap by design: one
 * connection, a handful of reads, no chunk rewriting.
 *
 * This file carries **anchors, not progress**. Era and epoch progress are
 * derived in the browser against its own clock (design doc §6.6a), so a
 * countdown ticks smoothly and costs no network traffic. Writing a
 * precomputed `eraProgress` here would be stale the moment it was written and
 * would invite the UI to display it rather than derive it — hence the schema
 * has no such field.
 *
 *   npm run ingest:latest
 */

import { join } from 'node:path';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';
import { connect } from '../../lib/chain/connect';
import {
  readActiveEra,
  readCurrentEra,
  readElectionPhase,
  readEraExposures,
  readEraPreferences,
  readEraRewardPoints,
  readEraStartSessionIndex,
  readEraTimingConsts,
  readEraTotalStake,
  readInflationConsts,
  readMaxExposurePageSize,
  readSlotInfo,
  readTotalIssuance,
  readValidatorSet,
} from '../../lib/chain/compat';
import { erasPerYear as computeErasPerYear, stakingReturns } from '../../lib/metrics/staking';
import type { Latest, LatestOperator } from '../../lib/schemas/data';
import { DataStore } from './store';

const round = (value: number, dp: number): number => Number(value.toFixed(dp));

async function main(): Promise<void> {
  const network = resolveNetwork();
  const endpoint = resolveRpcUrl(network);
  const store = new DataStore(join(process.cwd(), 'public', 'data'));

  console.log(`Connecting to ${network.label} at ${endpoint}`);
  const { api, disconnect } = await connect({ endpoint });

  try {
    const activeEra = await readActiveEra(api);

    const [
      currentEra,
      totalIssuance,
      totalStaked,
      slots,
      eraStartSessionIndex,
      electionPhase,
      validatorSet,
      points,
      prefs,
      exposures,
    ] = await Promise.all([
      readCurrentEra(api),
      readTotalIssuance(api),
      readEraTotalStake(api, activeEra.index),
      readSlotInfo(api),
      readEraStartSessionIndex(api, activeEra.index),
      readElectionPhase(api),
      readValidatorSet(api),
      readEraRewardPoints(api, activeEra.index),
      readEraPreferences(api, activeEra.index),
      readEraExposures(api, activeEra.index),
    ]);

    const timing = readEraTimingConsts(api);
    const { fixedYearlyReward } = readInflationConsts(api);
    const erasPerYear = computeErasPerYear(timing);
    const maxPageSize = readMaxExposurePageSize(api);

    const stakingRatio = totalIssuance > 0n ? Number(totalStaked) / Number(totalIssuance) : 0;
    const { inflation, apr } = stakingReturns({
      stakingRatio,
      totalIssuance,
      fixedYearlyReward,
      erasPerYear,
    });

    const activeSet = new Set(validatorSet.active);

    const operators: LatestOperator[] = exposures.exposures.map((exposure) => {
      const nominatorCount = exposure.nominatorCount;
      // Purely how many pages the payout is split across. Every page is
      // rewarded on Polymesh, and the chain pays them automatically, so this
      // is a mechanic rather than a risk — see the note on `pageCount` in
      // `lib/schemas/data.ts` and `npm run probe:payouts`.
      const pageCount =
        maxPageSize == null ? 1 : Math.max(1, Math.ceil(nominatorCount / maxPageSize));

      return {
        address: exposure.address,
        points: Number(points.operators.get(exposure.address) ?? 0n),
        commission: round(prefs.get(exposure.address)?.commission ?? 0, 5),
        totalStake: exposure.total.toString(),
        ownStake: exposure.own.toString(),
        nominatorCount,
        pageCount,
        blocked: prefs.get(exposure.address)?.blocked ?? false,
        elected: activeSet.has(exposure.address),
      };
    });

    const eraStartSeconds =
      activeEra.startMs != null
        ? Math.floor(activeEra.startMs / 1000)
        : Math.floor(Date.now() / 1000);

    const latest: Latest = {
      schemaVersion: 1,
      activeEra: activeEra.index,
      // Surfaced in the UI as "as of HH:MM". A snapshot must never look live.
      generatedAt: new Date().toISOString(),
      eraStatus: {
        currentEra,
        eraStart: eraStartSeconds,
        // Slot-derived progress is exact; the wall clock is the fallback.
        eraStartSlot: (
          slots.genesisSlot +
          BigInt(eraStartSessionIndex ?? 0) * BigInt(timing.epochDurationBlocks)
        ).toString(),
        eraStartSessionIndex: eraStartSessionIndex ?? 0,
        currentSlot: slots.currentSlot.toString(),
        currentSessionIndex: slots.currentSessionIndex,
        epochIndex: Number(slots.epochIndex),
        genesisSlot: slots.genesisSlot.toString(),
        sessionsPerEra: timing.sessionsPerEra,
        epochDurationBlocks: timing.epochDurationBlocks,
        expectedBlockTimeMs: timing.expectedBlockTimeMs,
        electionPhase,
      },
      totalIssuance: totalIssuance.toString(),
      fixedYearlyReward: fixedYearlyReward.toString(),
      totalStaked: totalStaked.toString(),
      stakingRatio: round(stakingRatio, 6),
      inflation: round(inflation, 6),
      impliedApr: round(apr, 6),
      validatorCount: {
        active: validatorSet.active.length,
        waiting: validatorSet.waiting.length,
        max: validatorSet.max,
      },
      operators,
    };

    const bytes = await store.writeLatest(latest);
    console.log(
      `Wrote latest.json (${(bytes / 1024).toFixed(1)} KB): era ${activeEra.index}, ` +
        `${operators.length} operators, election ${electionPhase}, ` +
        `staking ratio ${(stakingRatio * 100).toFixed(2)}%`,
    );
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
