/**
 * Builds `offences.json` — every offence ever reported against a validator.
 *
 * Indexer only, no RPC connection: two requests for the chain's whole history,
 * so it is cheap enough to re-run on every era ingest rather than scheduling it
 * separately. See `lib/indexer/offences.ts` for why `staking.SlashReported` is
 * the source and `imOnline.SomeOffline` is not.
 *
 * Rebuilt wholesale each run. There is nothing to accumulate — unlike
 * `slashes.json`, whose chain-state source is pruned to ~84 eras and which must
 * therefore retain what it has already seen, the indexer keeps events forever.
 *
 * `npm run ingest:offences`
 */
import { resolve } from 'node:path';
import { encodeAddress } from '@polkadot/util-crypto';
import { resolveNetwork } from '../../config/networks';
import { fetchSlashReports, groupOffences } from '../../lib/indexer/offences';
import { OffencesSchema } from '../../lib/schemas/data';
import { DataStore } from './store';

const DATA_ROOT = resolve(process.cwd(), 'public/data');

async function main(): Promise<void> {
  const network = resolveNetwork();
  const store = new DataStore(DATA_ROOT);

  console.log('Fetching reported offences from the indexer…');
  const raw = await fetchSlashReports({
    onProgress: (loaded, total) => console.log(`  ${loaded}/${total} reports`),
  });

  // The event carries a raw public key; every join downstream is on SS58, and
  // the prefix is per-network — mainnet is 12, testnet differs. Encoding here
  // rather than in the client keeps `@polkadot/util-crypto` out of the bundle.
  const reports = groupOffences(raw, (publicKey) => {
    try {
      return encodeAddress(publicKey, network.ss58Format);
    } catch {
      return null;
    }
  });

  const file = OffencesSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    lastEra: reports[0]?.era ?? null,
    reports,
  });

  const bytes = await store.writeOffences(file);
  const operators = new Set(reports.map((r) => r.address)).size;
  console.log(
    `Wrote offences.json: ${reports.length} incidents from ${raw.length} events, ` +
      `${operators} operators, ${(bytes / 1024).toFixed(1)} KB`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
