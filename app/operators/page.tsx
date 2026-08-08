import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OperatorsView } from '@/components/operators-view';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Operators',
  description:
    'Every Polymesh operator ranked by return, commission, stake and reliability. Pin operators to compare them.',
};

export default function OperatorsPage() {
  return (
    <main id="main">
      <div className="max-w-[65ch]">
        <h1 className="text-3xl leading-9 font-semibold tracking-tight">Operators</h1>
        <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
          Every operator, ranked and filterable. Return is after commission, so it is what a
          nominator would actually earn. Sort by steadiness to find operators whose return does not
          swing — two with the same average are not equivalent if one of them halves some weeks.
        </p>
      </div>

      {/* Both the era range and the pinned selection live in the URL, so this
          subtree reads useSearchParams and needs a boundary under static
          export. */}
      <Suspense fallback={<Skeleton height={560} label="Loading operators" />}>
        <OperatorsView />
      </Suspense>
    </main>
  );
}
