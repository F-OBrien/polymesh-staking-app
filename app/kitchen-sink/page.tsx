import type { Metadata } from 'next';
import { KitchenSink } from '@/components/kitchen-sink';

export const metadata: Metadata = {
  title: 'Chart kit',
  description: 'Internal reference for the chart primitives.',
  robots: { index: false, follow: false },
};

/**
 * Internal reference for the chart kit.
 *
 * Every primitive rendered against real (or synthetic) data, in one place, so
 * theming, dark mode and small viewports can be checked at a glance and
 * visual-regression baselines have somewhere to point. Not linked from the nav
 * and marked noindex — it is a workbench, not a page.
 */
export default function KitchenSinkPage() {
  return (
    <main id="main">
      <h1 className="text-3xl leading-9 font-semibold tracking-tight">Chart kit</h1>
      <p className="mt-3 max-w-[60ch]" style={{ color: 'var(--text-secondary)' }}>
        Internal reference. Every chart primitive against live data, for checking theming, dark
        mode, small viewports and keyboard navigation in one place.
      </p>
      <KitchenSink />
    </main>
  );
}
