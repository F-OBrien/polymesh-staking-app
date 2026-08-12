import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from './generate';
import {
  ChunkSchema,
  LatestSchema,
  ManifestSchema,
  OffencesSchema,
  OperatorRegistrySchema,
  RollupSchema,
  SlashesSchema,
} from '../../lib/schemas/data';

/**
 * That the generator still produces schema-valid output.
 *
 * It has broken twice by staying behind a schema — `fixedYearlyReward` on
 * `LatestSchema`, then the band and commission columns on `RollupSchema` — and
 * both times the only signal was a red CI job, which went unnoticed for weeks.
 * That matters more than it sounds: the Pages workflow falls back to fixtures
 * when the data branch is empty, so a broken generator blocks the deploy.
 *
 * Small and fast on purpose. The generator is deterministic, so eight eras
 * exercise every artefact it writes in well under a second.
 */
describe('the fixture generator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'fixture-test-'));
    await generate({ eras: 8, operators: 5, seed: 42, outDir, force: true });
  }, 30_000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const read = async (name: string) => JSON.parse(await readFile(join(outDir, name), 'utf8'));

  it('writes a manifest that parses', async () => {
    const manifest = ManifestSchema.parse(await read('manifest.json'));
    expect(manifest.chunks.length).toBeGreaterThan(0);
  });

  it('writes chunks that parse', async () => {
    const manifest = ManifestSchema.parse(await read('manifest.json'));
    for (const ref of manifest.chunks) {
      expect(() => ChunkSchema.parse(null)).toThrow();
      const chunk = ChunkSchema.parse(await read(ref.path));
      expect(chunk.eras.length).toBeGreaterThan(0);
    }
  });

  it('writes a latest.json carrying every field the app reads', async () => {
    const latest = LatestSchema.parse(await read('latest.json'));
    // Named explicitly: this is the field whose absence broke CI.
    expect(BigInt(latest.fixedYearlyReward)).toBeGreaterThan(0n);
    expect(latest.operators.length).toBeGreaterThan(0);
  });

  it('writes a rollup with the columns a weekly chart needs', async () => {
    const rollup = RollupSchema.parse(await read('rollup-weekly.json'));
    // The band and commission, without which switching to weekly resolution
    // would silently drop series from the chart rather than coarsen them.
    expect(rollup.aprP10.length).toBe(rollup.avgApr.length);
    expect(rollup.aprP90.length).toBe(rollup.avgApr.length);
    expect(rollup.avgCommission.length).toBe(rollup.avgApr.length);
    expect(rollup.nominatorCount.length).toBe(rollup.avgApr.length);
  });

  it('writes an operator registry and a slashes file that parse', async () => {
    expect(Object.keys(OperatorRegistrySchema.parse(await read('operators.json'))).length).toBe(5);
    expect(SlashesSchema.parse(await read('slashes.json')).scope).toBe('Validator');
  });

  it('writes offence reports, including ones that cost nothing', async () => {
    const offences = OffencesSchema.parse(await read('offences.json'));
    expect(offences.reports.length).toBeGreaterThan(0);
    // Mainnet's entire record is zero-penalty reports, so a fixture without one
    // would never render the row shape production actually has.
    expect(offences.reports.some((report) => report.fraction === 0)).toBe(true);
    expect(offences.lastEra).toBe(offences.reports[0]!.era);
  });
});
