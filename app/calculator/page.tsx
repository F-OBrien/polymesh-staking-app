import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CalculatorView } from '@/components/calculator-view';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Calculator',
  description:
    'Project staking rewards on Polymesh from measured operator performance, with a range based on how variable that return has actually been.',
};

export default function CalculatorPage() {
  return (
    <main id="main">
      <div className="max-w-[65ch]">
        <h1 className="text-3xl leading-9 font-semibold tracking-tight">Calculator</h1>
        <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
          Projected from what operators have actually earned over the era range you choose, not from
          a headline rate. The answer is a range rather than a number, because the return moves —
          and how much it moves is itself worth knowing before you bond anything.
        </p>
      </div>

      <Suspense fallback={<Skeleton height={480} label="Loading calculator" />}>
        <CalculatorView />
      </Suspense>
    </main>
  );
}
