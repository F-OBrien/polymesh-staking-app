/**
 * Builds `era-index.json` — every era's start block and timestamp, for the
 * chain's whole life.
 *
 * Runs against the indexer only; no RPC connection at all. About eighteen
 * requests for 1,749 eras, so it is cheap enough to re-run on every era ingest
 * rather than treating it as a one-off — and re-running is what keeps it
 * current without a separate schedule.
 *
 * `npm run ingest:era-index`
 */
import { resolve } from 'node:path';
import { buildEraIndex, fetchEraTransitions } from '../../lib/indexer/era-transitions';
import { EraIndexSchema } from '../../lib/schemas/data';
import { DataStore } from './store';

const DATA_ROOT = resolve(process.cwd(), 'public/data');

async function main(): Promise<void> {
  const store = new DataStore(DATA_ROOT);

  console.log('Fetching era transitions from the indexer…');
  const transitions = await fetchEraTransitions({
    onProgress: (loaded, total) => {
      // A twenty-request walk should say so rather than look hung.
      if (loaded % 500 === 0 || loaded === total) {
        console.log(`  ${loaded}/${total} transitions`);
      }
    },
  });

  const { firstEra, block, start } = buildEraIndex(transitions);

  const file = EraIndexSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    firstEra,
    block,
    start,
  });

  const bytes = await store.writeEraIndex(file);

  const lastEra = firstEra + start.length - 1;
  const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');

  console.log(
    `\nWrote era-index.json (${(bytes / 1024).toFixed(1)} KB): ` +
      `eras ${firstEra}–${lastEra} (${start.length}), ` +
      `${iso(start[0]!)} to ${iso(start.at(-1)!)}`,
  );

  // The drift is the whole reason this file exists rather than a formula, so
  // the run reports it. If it ever reads as zero, something is synthesising
  // timestamps instead of reading them.
  const span = start.at(-1)! - start[0]!;
  const nominal = (start.length - 1) * 86_400;
  const driftHours = (span - nominal) / 3600;
  console.log(
    `Drift against a nominal 24h era: ${driftHours >= 0 ? '+' : ''}${driftHours.toFixed(1)}h ` +
      `over ${start.length - 1} eras — this is why era↔date is a lookup, not arithmetic.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
