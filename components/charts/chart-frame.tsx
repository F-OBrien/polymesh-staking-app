'use client';

import { Tabs } from 'radix-ui';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ErrorState, Skeleton } from '@/components/states';

/**
 * The plot height a chart should draw at, given the height it asked for.
 *
 * Non-null only inside an expanded frame.
 *
 * **Call this from a component rendered as a `child` of `ChartFrame`, never
 * from the component that renders the frame.** The provider wraps `children`,
 * so a hook call in the parent sits *above* it and gets the collapsed height
 * back with no error — the chart then grows wider on expand and stays exactly
 * as short as before, which is usually the axis that needed the room. Three of
 * the four charts in the kit had this bug; each now has a `…Plot` component
 * whose only reason to exist is to be on the right side of this boundary.
 */
const ExpandedHeightContext = createContext<number | null>(null);

export function useChartHeight(requested: number): number {
  return useContext(ExpandedHeightContext) ?? requested;
}

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

  /**
   * Expanded height, doubling as the open flag.
   *
   * A dense chart — eight operators over ninety eras — is legible at 2300px and
   * a thicket at 900. Rather than a height control nobody would find, the whole
   * frame moves into a modal that uses the viewport. Measured on open in the
   * click handler rather than an effect, so opening costs one render.
   */
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
  const expanded = expandedHeight != null;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    // `showModal` — not the `open` attribute — is what puts the dialog in the
    // top layer and brings the focus trap, inertness and Escape with it.
    if (expanded && !element.open) element.showModal();
    if (!expanded && element.open) element.close();
  }, [expanded]);

  const expand = () => {
    // Leave room for the header, legend and tab strip inside the modal.
    setExpandedHeight(Math.max(height, Math.round(window.innerHeight * 0.92) - 240));
  };
  const collapse = () => setExpandedHeight(null);

  const header = (
    // Not `flex-wrap`. The coverage line varies in length with the range, the
    // scale and whether a cap is in force, and wrapping let a longer one push
    // the controls onto their own row — so the Expand and scale buttons moved
    // around the card as the reader changed the very things those buttons
    // control. `flex-1 min-w-0` lets the text column shrink and wrap inside
    // itself instead, which keeps the controls anchored top-right.
    <figcaption className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
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

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <FrameButton
          onClick={expanded ? collapse : expand}
          label={expanded ? `Close the expanded ${title}` : `Expand ${title} to full screen`}
        >
          <span aria-hidden="true">{expanded ? '✕' : '⤢'}</span>
          {expanded ? 'Close' : 'Expand'}
        </FrameButton>
      </div>
    </figcaption>
  );

  const body = error ? (
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
    // The chart is mounted in exactly one place at a time — inline or in the
    // modal — so expanding never renders two copies of a heavy SVG.
    <ExpandedHeightContext.Provider value={expandedHeight}>
      <Tabs.Root defaultValue="chart" className="flex min-h-0 flex-col gap-3">
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

        <Tabs.Content
          value="table"
          className="min-h-0 overflow-auto focus-visible:outline-none"
          style={{ maxHeight: (expandedHeight ?? height) * 1.5 }}
        >
          {table}
        </Tabs.Content>
      </Tabs.Root>
    </ExpandedHeightContext.Provider>
  );

  return (
    <>
      <figure
        className="m-0 flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
      >
        {header}
        {/* While expanded the inline card keeps its footprint, so closing the
            modal returns you to the same scroll position. */}
        {expanded ? (
          <div
            className="flex items-center justify-center rounded-[var(--radius-sm)] border border-dashed text-sm"
            style={{ height, borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            Shown full screen
          </div>
        ) : (
          body
        )}
      </figure>

      {expanded ? (
        <dialog
          ref={dialogRef}
          aria-label={title}
          onClose={collapse}
          // A click on the backdrop lands on the dialog itself, since the
          // content sits in a child element.
          onClick={(event) => {
            if (event.target === dialogRef.current) collapse();
          }}
          className="m-auto max-w-none rounded-[var(--radius-lg)] border p-0 backdrop:bg-black/60"
          style={{
            width: '96vw',
            // Sized to content, not `92vh`: only the banded chart takes the
            // extra height (via the context above), and a 300px curve floating
            // in a full-height box looks broken.
            //
            // `fit-content` rather than `auto` — the UA stylesheet gives a
            // modal dialog `inset: 0`, and `height: auto` against both a top
            // and a bottom offset resolves to "fill", which stretched the box
            // to the full viewport with 600px of dead space under the chart.
            height: 'fit-content',
            maxHeight: '92vh',
            borderColor: 'var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text-primary)',
          }}
        >
          <div className="flex max-h-[92vh] flex-col gap-3 overflow-auto p-4">
            {header}
            {body}
          </div>
        </dialog>
      ) : null}
    </>
  );
}

function FrameButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {children}
    </button>
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
