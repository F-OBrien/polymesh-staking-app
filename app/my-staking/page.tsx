import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MyStakingView } from '@/components/my-staking-view';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'My Staking',
  description:
    'Inspect any Polymesh stash: bonded and unbonding balances, nominations with warnings, and every staking reward it has been paid. No wallet required.',
};

export default function MyStakingPage() {
  return (
    <main id="main">
      <div className="max-w-[65ch]">
        <h1 className="text-3xl leading-9 font-semibold tracking-tight">My Staking</h1>
        <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
          Everything about one stash: what is bonded, what is unbonding and when it unlocks, which
          operators it backs and whether any of them need attention, and every reward it has been
          paid. Works with a wallet or with any address you paste — and it is read-only, so you will
          never be asked to sign anything.
        </p>
      </div>

      <Suspense fallback={<Skeleton height={420} label="Loading" />}>
        <MyStakingView />
      </Suspense>
    </main>
  );
}
