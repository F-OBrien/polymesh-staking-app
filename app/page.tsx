import type { Metadata } from 'next';
import { NetworkPulse } from '@/components/network-pulse';

export const metadata: Metadata = {
  description:
    'Live staking metrics for Polymesh: returns, stake, inflation, and operator performance.',
};

/**
 * Home.
 *
 * Replaces the previous app's placeholder ("This is the home page. Not much to
 * see here."). Everything above the fold renders from `latest.json` alone, so
 * the page is useful before any era chunk has loaded.
 *
 * Phase 4 adds the staking-ratio gauge and sparklines once the chart kit exists.
 */
export default function HomePage() {
  return (
    <main id="main">
      <section className="max-w-[60ch]">
        <h1 className="text-3xl leading-9 font-semibold tracking-tight">
          Polymesh staking, in the open
        </h1>
        <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
          Operator performance, network returns, and your own position — measured from public chain
          data, with every formula written down.
        </p>
      </section>

      <NetworkPulse />
    </main>
  );
}
