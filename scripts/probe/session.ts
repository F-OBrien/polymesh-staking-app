/**
 * What can honestly be said about era, session and election timing?
 *
 * `latest.json` already carries the anchors, but two of the things the UI would
 * want to show need checking before they are shown at all:
 *
 *  - **Is there an election phase to report?** `readElectionPhase` returns
 *    `'Off'` when `electionProviderMultiPhase` is *absent*, which is the same
 *    "cannot tell missing from empty" trap that `readEraSlashes` had. Polymesh's
 *    validator set is permissioned, so the multi-phase election machinery may
 *    simply not be installed — in which case reporting "Off" is inventing a
 *    status for a thing that does not exist.
 *  - **Is a new era actually coming?** `staking.forceEra` can hold the set still
 *    (`ForceNone`), and a countdown to an era that will not roll is a lie.
 *
 * `npm run probe:session`
 */
import { connect } from '../../lib/chain/connect';
import { resolveNetwork, resolveRpcUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main(): Promise<void> {
  const { api, disconnect } = await connect({ endpoint: resolveRpcUrl(resolveNetwork()) });

  try {
    console.log('Does the multi-phase election pallet exist?');
    const election = api.query.electionProviderMultiPhase;
    console.log(`  electionProviderMultiPhase: ${election == null ? 'ABSENT' : 'present'}`);
    if (election != null) {
      console.log(`  storage: ${Object.keys(election).join(', ')}`);
      const phase: any = await election.currentPhase?.();
      console.log(`  currentPhase = ${phase?.toString()}`);
    }

    console.log('\nStaking / session pallets available for era timing:');
    for (const [pallet, item] of [
      ['staking', 'forceEra'],
      ['staking', 'currentEra'],
      ['staking', 'activeEra'],
      ['staking', 'erasStartSessionIndex'],
      ['session', 'currentIndex'],
      ['session', 'validators'],
      ['babe', 'epochIndex'],
      ['babe', 'currentSlot'],
      ['babe', 'genesisSlot'],
    ] as const) {
      const present = (api.query as any)[pallet]?.[item] != null;
      console.log(`  ${pallet}.${item}: ${present ? 'yes' : 'NO'}`);
    }

    const forceEra: any = await api.query.staking.forceEra?.();
    console.log(`\nstaking.forceEra = ${forceEra?.toString()}`);
    console.log('  (NotForcing = eras roll normally; ForceNone = the set is frozen)');

    const [activeEra, currentEra, sessionIndex, epochIndex, currentSlot]: any[] = await Promise.all(
      [
        api.query.staking.activeEra(),
        api.query.staking.currentEra(),
        api.query.session.currentIndex(),
        api.query.babe.epochIndex(),
        api.query.babe.currentSlot(),
      ],
    );

    const active = Number(activeEra.unwrap().index.toString());
    const startSession: any = await api.query.staking.erasStartSessionIndex(active);

    const sessionsPerEra = Number(api.consts.staking.sessionsPerEra.toString());
    const epochDuration = Number((api.consts.babe.epochDuration as any).toString());
    const blockMs = Number((api.consts.babe.expectedBlockTime as any).toString());

    const eraStartSession = Number(startSession.unwrap().toString());
    const sessionInEra = Number(sessionIndex.toString()) - eraStartSession;

    console.log(`\nactive era        ${active}`);
    console.log(`current era       ${currentEra.unwrap().toString()}`);
    console.log(`session index     ${sessionIndex.toString()}`);
    console.log(`era start session ${eraStartSession}`);
    console.log(
      `position in era   session ${sessionInEra + 1} of ${sessionsPerEra}` +
        `${sessionInEra + 1 === sessionsPerEra ? '  <- final session; the next set is elected at its end' : ''}`,
    );
    console.log(`epoch index       ${epochIndex.toString()}`);
    console.log(`current slot      ${currentSlot.toString()}`);
    console.log(
      `\nsession = ${epochDuration} blocks x ${blockMs}ms = ${(epochDuration * blockMs) / 3_600_000}h`,
    );
    console.log(
      `era     = ${sessionsPerEra} sessions = ${(sessionsPerEra * epochDuration * blockMs) / 3_600_000}h`,
    );

    // `currentEra` running ahead of `activeEra` is the observable signal that
    // the next set has been elected and is waiting to be applied.
    const planned = Number(currentEra.unwrap().toString());
    console.log(
      `\ncurrentEra - activeEra = ${planned - active}` +
        (planned > active
          ? '  <- the next era is already planned; its validator set is chosen'
          : '  <- no era queued yet'),
    );
  } finally {
    await disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
