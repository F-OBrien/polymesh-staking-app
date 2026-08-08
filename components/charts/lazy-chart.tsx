'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/states';

/**
 * Defers chart rendering until it is needed.
 *
 * Two separate mechanisms, solving two separate problems:
 *
 *  1. **`next/dynamic` splits the chart kit into its own chunk.** d3-scale +
 *     d3-shape (14.4 KB) and Radix Tabs (9.0 KB) then load *after* first paint
 *     rather than blocking it. This is what keeps the critical path under
 *     budget — measured at 218 KB when the kit was statically imported, against
 *     a 200 KB budget and a ~182 KB framework floor.
 *  2. **An IntersectionObserver gates the mount.** `/network` carries eight
 *     charts; rendering all of them on load costs layout and derivation work
 *     for charts the reader may never scroll to.
 *
 * Both matter. Splitting alone still mounts everything at once; gating alone
 * still puts d3 on the critical path.
 *
 * `ssr: false` is correct rather than lazy: charts measure their container
 * before drawing (see `useMeasuredWidth`), so there is nothing meaningful to
 * prerender — the server would emit an empty box either way.
 */

const EraSeriesChartImpl = dynamic(
  () => import('./era-series-chart').then((m) => m.EraSeriesChart),
  {
    ssr: false,
    // No placeholder here: `LazyChart` already reserves the exact height, and a
    // second skeleton inside the first would flash on top of it.
    loading: () => null,
  },
);

const XyLineChartImpl = dynamic(() => import('./xy-line-chart').then((m) => m.XyLineChart), {
  ssr: false,
  loading: () => null,
});

export type { EraSeriesChartProps } from './era-series-chart';
export type { XyLineChartProps, XySeries } from './xy-line-chart';

/**
 * Wraps a chart so it mounts only once scrolled near.
 *
 * The reserved height is the chart's own, so nothing shifts when it arrives —
 * the CLS budget is zero, and a chart appearing 400px down the page is exactly
 * where layout shift usually comes from.
 */
export function LazyChart({
  height,
  label,
  children,
  /** Distance ahead of the viewport at which to start loading. */
  rootMargin = '400px',
}: {
  height: number;
  label: string;
  children: ReactNode;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Without IntersectionObserver, render everything. Degrading to "load it
    // all" is right: the alternative is a permanently blank chart. Deferred to
    // the next frame rather than set synchronously, which would cascade a
    // second render out of the effect body.
    if (typeof IntersectionObserver === 'undefined') {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          // One-shot: once mounted, a chart stays mounted. Unmounting on scroll
          // would discard its state and re-run every derivation.
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : height }}>
      {visible ? children : <Skeleton height={height} label={`${label} — loading`} />}
    </div>
  );
}

/**
 * The chart itself, code-split. Import this rather than `./era-series-chart`
 * from any page, so the kit never lands on the critical path.
 */
export const LazyEraSeriesChart = EraSeriesChartImpl;

/** As above, for the numeric-x chart used by the slashing penalty curves. */
export const LazyXyLineChart = XyLineChartImpl;
