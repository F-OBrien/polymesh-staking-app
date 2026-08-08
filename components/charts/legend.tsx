'use client';

import { SERIES_TOKENS } from '@/lib/charts/palette';

/**
 * Chart legend.
 *
 * Always present for two or more series, and never the *only* way a series is
 * identified — the chart also direct-labels its first four, and the table
 * carries all of them.
 *
 * It is a list of swatch-plus-name pairs rather than a colour key you have to
 * hold in your head, and the label text uses text tokens so a low-contrast
 * series colour never becomes something you must read.
 */

export interface LegendItem {
  id: string;
  label: string;
  /** Reference lines and the band are dashed, matching how they are drawn. */
  variant?: 'solid' | 'dashed' | 'band';
  /** Overrides the palette slot; used for the band, median and reference. */
  colour?: string;
  onRemove?: (() => void) | undefined;
}

export function Legend({ items }: { items: readonly LegendItem[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0 text-xs">
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center gap-1.5">
          <Swatch
            colour={item.colour ?? SERIES_TOKENS[index % SERIES_TOKENS.length]!}
            variant={item.variant ?? 'solid'}
          />
          <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
          {item.onRemove ? (
            <button
              type="button"
              onClick={item.onRemove}
              className="rounded-full px-1 leading-none"
              style={{ color: 'var(--text-muted)' }}
              aria-label={`Remove ${item.label} from the chart`}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Swatch({ colour, variant }: { colour: string; variant: 'solid' | 'dashed' | 'band' }) {
  if (variant === 'band') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-3.5 shrink-0 rounded-[2px]"
        style={{ background: colour, border: '1px solid var(--border)' }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-block h-0.5 w-3.5 shrink-0"
      style={
        variant === 'dashed'
          ? {
              backgroundImage: `repeating-linear-gradient(90deg, ${colour} 0 3px, transparent 3px 6px)`,
            }
          : { background: colour }
      }
    />
  );
}
