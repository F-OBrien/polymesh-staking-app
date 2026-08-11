import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MyStakingView } from '@/components/my-staking-view';
import { HeadingWithTip } from '@/components/info-tip';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'My Staking',
  description:
    'Inspect any Polymesh stash: bonded and unbonding balances, nominations with warnings, and every staking reward it has been paid. No wallet required.',
};

export default function MyStakingPage() {
  return (
    <main id="main">
      <HeadingWithTip
        as="h1"
        title="My Staking"
        lead="Everything about one stash — with a wallet, or with any address you paste."
      >
        What is bonded, what is unbonding and when it unlocks, which operators it backs and whether
        any of them need attention, and every reward it has been paid. It is read-only, so you will
        never be asked to sign anything.
      </HeadingWithTip>

      <Suspense fallback={<Skeleton height={420} label="Loading" />}>
        <MyStakingView />
      </Suspense>
    </main>
  );
}
