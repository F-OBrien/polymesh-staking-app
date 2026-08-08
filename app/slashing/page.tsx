import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SlashingView } from '@/components/slashing-view';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Slashing',
  description:
    'Offences recorded on Polymesh, what each cost, and how the two slashing penalties scale with the number of operators failing at once.',
};

export default function SlashingPage() {
  return (
    <main id="main">
      <div className="max-w-[65ch]">
        <h1 className="text-3xl leading-9 font-semibold tracking-tight">Slashing</h1>
        <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
          Slashing is the one way staking can lose money rather than merely fail to earn it. It is
          rare on Polymesh — which makes it easy to ignore until it is not. This page shows what has
          actually happened, and what a penalty would cost if it did.
        </p>
      </div>

      <Suspense fallback={<Skeleton height={520} label="Loading slashing record" />}>
        <SlashingView />
      </Suspense>
    </main>
  );
}
