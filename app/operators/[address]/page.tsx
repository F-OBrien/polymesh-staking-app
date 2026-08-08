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
 */

interface OperatorRecordShape {
  name?: string;
  nodeLabel?: string;
}

async function readRegistry(): Promise<Record<string, OperatorRecordShape>> {
  try {
    const raw = await readFile(join(process.cwd(), 'public', 'data', 'operators.json'), 'utf8');
    return JSON.parse(raw) as Record<string, OperatorRecordShape>;
  } catch {
    // No dataset yet — a fresh clone before `npm run fixtures`, or a build in
    // an environment without the data branch. Build the rest of the site
    // rather than failing on a directory that will exist in CI.
    return {};
  }
}

export async function generateStaticParams(): Promise<{ address: string }[]> {
  const registry = await readRegistry();
  return Object.keys(registry).map((address) => ({ address }));
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
