import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CompareView } from '@/components/compare-view';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Compare',
  description:
    'Compare Polymesh operators side by side on return, steadiness, commission and self-stake. The selection lives in the URL, so a comparison can be shared.',
};

export default function ComparePage() {
  return (
    <main id="main">
      <div className="max-w-[65ch]">
        <h1 className="text-3xl leading-9 font-semibold tracking-tight">Compare</h1>
        <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
          Up to eight operators, side by side. The selection is held in the address bar, so this
          page can be sent to someone exactly as you see it — and it is the same set you pinned in
          the directory.
        </p>
      </div>

      <Suspense fallback={<Skeleton height={520} label="Loading comparison" />}>
        <CompareView />
      </Suspense>
    </main>
  );
}
