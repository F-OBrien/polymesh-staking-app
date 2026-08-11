import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NetworkAnalytics } from '@/components/network-analytics';
import { HeadingWithTip } from '@/components/info-tip';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Network',
  description:
    'Polymesh staking at the network level: returns, inflation, stake, participation and decentralisation.',
};

export default function NetworkPage() {
  return (
    <main id="main">
      <HeadingWithTip
        as="h1"
        title="Network"
        lead="What the network paid, how much is staked, and how evenly it is spread."
      >
        Every figure is derived from public chain data. The <a href="./about/">methodology</a> sets
        out each formula, including the reward curve constants and how the commission-weighted
        average is taken.
      </HeadingWithTip>

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
