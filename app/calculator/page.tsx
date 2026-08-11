import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CalculatorView } from '@/components/calculator-view';
import { HeadingWithTip } from '@/components/info-tip';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Calculator',
  description:
    'Project staking rewards on Polymesh from measured operator performance, with a range based on how variable that return has actually been.',
};

export default function CalculatorPage() {
  return (
    <main id="main">
      <HeadingWithTip
        as="h1"
        title="Calculator"
        lead="Projected from what operators have actually earned, not from a headline rate."
      >
        The answer is a range rather than a number, because the return moves — and how much it moves
        is itself worth knowing before you bond anything. The range comes from the variance of that
        operator’s own per-era return over the era range you choose.
      </HeadingWithTip>

      <Suspense fallback={<Skeleton height={480} label="Loading calculator" />}>
        <CalculatorView />
      </Suspense>
    </main>
  );
}
