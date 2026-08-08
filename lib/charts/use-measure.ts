'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Measures an element's width, so charts can draw at real pixel dimensions.
 *
 * This matters more than it looks. The obvious alternative — a fixed `viewBox`
 * with `width="100%"` — scales the *whole* drawing, text included, so an
 * 11px axis label becomes 4px on a phone. That is the same failure the previous
 * app worked around with an eight-branch font-size ladder keyed off
 * `window.innerWidth`, mutating Chart.js globals on every resize.
 *
 * Drawing at the measured width instead means text is always its natural size,
 * tick counts derive from real space, and there is no global state to mutate.
 *
 * Returns `null` until measured, so callers can skip the first paint rather
 * than render a chart at a guessed width and then reflow it.
 */
export function useMeasuredWidth<T extends HTMLElement>(): [
  (node: T | null) => void,
  number | null,
] {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // A callback ref rather than an effect: it fires when the node attaches,
  // which is earlier than an effect and handles the node being swapped out.
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node) return;

    // Measure immediately so the first paint has a real width where possible.
    setWidth(node.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // `contentRect` excludes padding and borders, which is what the plot box
      // should be sized against.
      const next = entry.contentRect.width;
      // Ignore sub-pixel churn; re-rendering a chart for 0.3px is pure waste.
      setWidth((current) => (current != null && Math.abs(current - next) < 1 ? current : next));
    });

    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, width];
}
