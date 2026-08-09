import type { Metadata } from 'next';
import { Suspense } from 'react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OperatorDetail } from '@/components/operator-detail';
import { Skeleton } from '@/components/states';

/**
 * One page per operator, prerendered at build time.
 *
 * Static export has no server and GitHub Pages has no rewrites, so every route
 * must exist as a file. The addresses come from the generated
 * `public/data/operators.json`, which the pipeline writes before the site is
 * built — around a hundred pages, which costs nothing.
 *
 * An address absent from that file 404s. That is the honest outcome: with no
 * server there is nowhere to resolve it, and the detail component already
 * explains the case where an address exists but has no data in range.
 *
 * **A missing dataset fails the build, deliberately.** An earlier revision
 * returned an empty list so a fresh clone would still build. That stopped
 * working in Next 16, which rejects an empty `generateStaticParams()` under
 * `output: export` — and the error it raises names neither the file nor the
 * command that creates it, which cost a CI run to diagnose. Failing here with
 * an actionable message is strictly better, and the silent version was never
 * right anyway: a site built without data would deploy with every operator
 * page missing.
 */

const REGISTRY_PATH = join(process.cwd(), 'public', 'data', 'operators.json');

const MISSING_DATA = `
public/data/operators.json is missing or empty, so there are no operator pages to build.

  Local development:  npm run fixtures
  CI:                 the workflow generates fixtures before building
  Deploy:             the "data" branch is checked out into public/data

That directory is gitignored — generated data never lives on a source branch.
`.trim();

interface OperatorRecordShape {
  name?: string;
  nodeLabel?: string;
}

async function readRegistry(): Promise<Record<string, OperatorRecordShape>> {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as Record<string, OperatorRecordShape>;
  } catch {
    return {};
  }
}

export async function generateStaticParams(): Promise<{ address: string }[]> {
  const registry = await readRegistry();
  const addresses = Object.keys(registry);

  if (addresses.length === 0) throw new Error(MISSING_DATA);

  return addresses.map((address) => ({ address }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const registry = await readRegistry();
  const name = registry[address]?.nodeLabel ?? registry[address]?.name;

  return {
    title: name ?? 'Operator',
    description: name
      ? `Staking performance for ${name} on Polymesh: return after commission, reliability, stake and commission history.`
      : 'Staking performance for a Polymesh operator.',
  };
}

export default async function OperatorPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  return (
    <main id="main">
      <Suspense fallback={<Skeleton height={560} label="Loading operator" />}>
        <OperatorDetail address={address} />
      </Suspense>
    </main>
  );
}
