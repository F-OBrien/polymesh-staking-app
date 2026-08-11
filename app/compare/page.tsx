import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CompareView } from '@/components/compare-view';
import { HeadingWithTip } from '@/components/info-tip';
import { Skeleton } from '@/components/states';

export const metadata: Metadata = {
  title: 'Compare',
  description:
    'Compare Polymesh operators side by side on return, steadiness, commission and self-stake. The selection lives in the URL, so a comparison can be shared.',
};

export default function ComparePage() {
  return (
    <main id="main">
      <HeadingWithTip as="h1" title="Compare" lead="Up to eight operators, side by side.">
        The selection is the same set you pinned in the directory, and it is held in the address bar
        — so this page can be sent to someone exactly as you see it. Pins persist as you move around
        the site, and clearing them clears them everywhere.
      </HeadingWithTip>

      <Suspense fallback={<Skeleton height={520} label="Loading comparison" />}>
        <CompareView />
      </Suspense>
    </main>
  );
}
