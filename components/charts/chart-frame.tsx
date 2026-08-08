'use client';

import { Tabs } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@/components/states';

/**
 * The shell every chart is rendered inside.
 *
 * It exists so that four things are structurally impossible to forget, rather
 * than left to each chart's author:
 *
 *  1. **A stated question.** The title says what the chart answers. If it does
 *     not answer one, it should not exist.
 *  2. **A table view.** Every chart's data is readable as a table, which is
 *     both the accessibility fallback and the relief required for the three
 *     light-mode series colours that sit under 3:1 contrast (design doc §7.3).
 *  3. **Loading, empty and error states** that reserve the same height as the
 *     chart, so nothing shifts when data lands. The CLS budget is zero.
 *  4. **Stated coverage.** A chart must never imply data exists where it does
 *     not — it says what range it is actually showing.
 *
 * Radix Tabs supplies the roving-tabindex and aria wiring for the toggle. That
 * is the class of work worth taking from a library: fiddly, well-specified, and
 * nothing to do with our visual identity.
 */

export type ChartView = 'chart' | 'table';

export interface ChartFrameProps {
  /** The question this chart answers, phrased as a statement. */
  title: string;
  subtitle?: string | undefined;
  /** What the data actually covers, e.g. "84 eras · 12 May – 3 Aug". */
  coverage?: string | undefined;
  /** Freshness stamp, era-range control, or a metric switch. */
  actions?: ReactNode;
  /** Rendered legend; sits above the plot so it is read before the marks. */
  legend?: ReactNode;
  children: ReactNode;
  /** The same data as an accessible table. Required — see (2) above. */
  table: ReactNode;
  height: number;
  loading?: boolean | undefined;
  error?: Error | null | undefined;
  onRetry?: (() => void) | undefined;
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: ReactNode;
}

export function ChartFrame({
  title,
  subtitle,
  coverage,
  actions,
  legend,
  children,
  table,
  height,
  loading = false,
  error,
  onRetry,
  empty,
}: ChartFrameProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <figure
      className="m-0 flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? descriptionId : undefined}
    >
      <figcaption className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="m-0 text-[17px] leading-6 font-semibold tracking-tight">
            {title}
          </h3>
          {subtitle ? (
            <p
              id={descriptionId}
              className="mt-0.5 mb-0 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              {subtitle}
            </p>
          ) : null}
          {coverage ? (
            <p className="mt-0.5 mb-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              {coverage}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </figcaption>

      {error ? (
        <ErrorState
          compact
          title="Could not load this chart"
          message={error.message}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : loading ? (
        // Exactly the chart's height, so nothing moves when data arrives.
        <Skeleton height={height} label={`Loading ${title}`} />
      ) : empty ? (
        <div style={{ minHeight: height }} className="flex items-center justify-center">
          {empty}
        </div>
      ) : (
        <Tabs.Root defaultValue="chart" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            {legend ? <div className="min-w-0 flex-1">{legend}</div> : <div />}

            <Tabs.List
              aria-label={`View ${title} as`}
              className="flex shrink-0 items-center gap-0.5 rounded-full border p-0.5 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              <ViewTab value="chart">Chart</ViewTab>
              <ViewTab value="table">Table</ViewTab>
            </Tabs.List>
          </div>

          <Tabs.Content value="chart" className="focus-visible:outline-none">
            {children}
          </Tabs.Content>

          <Tabs.Content value="table" className="focus-visible:outline-none">
            <div className="overflow-x-auto" style={{ maxHeight: height * 1.5 }}>
              {table}
            </div>
          </Tabs.Content>
        </Tabs.Root>
      )}
    </figure>
  );
}

function ViewTab({ value, children }: { value: ChartView; children: ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="rounded-full px-2.5 py-1 transition-colors data-[state=active]:font-semibold"
      style={{ color: 'var(--text-muted)' }}
      // Active state is background plus weight, not colour alone.
      data-chart-view={value}
    >
      {children}
    </Tabs.Trigger>
  );
}
