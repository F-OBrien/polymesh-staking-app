import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NetworkAnalytics } from '@/components/network-analytics';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Network',
  description:
    'Polymesh staking at the network level: returns, inflation, stake, participation and decentralisation.',
};

export default function NetworkPage() {
  return (
    <main id="main">
      <div className="max-w-[65ch]">
        <h1 className="text-3xl leading-9 font-semibold tracking-tight">Network</h1>
        <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
          What the network paid, how much is staked, who is producing blocks, and how evenly stake
          is spread. Every figure is derived from public chain data — the{' '}
          <a href="./about/">methodology</a> sets out each formula.
        </p>
      </div>

      {/* The era range lives in the URL, so this subtree reads useSearchParams
          and must sit behind a Suspense boundary for static export. The
          fallback reserves roughly the height of the first screen of content,
          so the page does not jump when it resolves. */}
      <Suspense fallback={<Skeleton height={520} label="Loading network analytics" />}>
        <NetworkAnalytics />
      </Suspense>
    </main>
  );
}
