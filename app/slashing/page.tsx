import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SlashingView } from '@/components/slashing-view';
import { HeadingWithTip } from '@/components/info-tip';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Slashing',
  description:
    'Offences recorded on Polymesh, what each cost, and how the two slashing penalties scale with the number of operators failing at once.',
};

export default function SlashingPage() {
  return (
    <main id="main">
      <HeadingWithTip
        as="h1"
        title="Slashing"
        lead="The one way staking can lose money rather than merely fail to earn it."
      >
        On Polymesh, slashing applies to operators&rsquo; own stake and not to nominated tokens — a
        governance switch that is read from the chain on every run rather than assumed. It has also
        been rare. This page shows what has actually happened, who it would fall on, and what a
        penalty would cost if it did.
      </HeadingWithTip>

      <Suspense fallback={<Skeleton height={520} label="Loading slashing record" />}>
        <SlashingView />
      </Suspense>
    </main>
  );
}
