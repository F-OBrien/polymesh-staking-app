'use client';

import { formatEraDate } from '@/lib/format';

/**
 * The table behind every chart.
 *
 * Three jobs, all of them load-bearing:
 *
 *  - **Accessibility.** An SVG chart is not readable by assistive technology
 *    however carefully it is labelled. This is the same data, in a real table.
 *  - **Contrast relief.** Three light-mode series colours sit under 3:1 against
 *    the surface (design doc §7.3). The rule is that any chart using them ships
 *    visible direct labels *or* a table view — this satisfies it universally.
 *  - **Getting the numbers out.** Users want to check a figure or copy a
 *    column. The previous app rendered to canvas, so the data was unreachable.
 *
 * Rendered inside the frame's Table tab, and additionally as a visually-hidden
 * copy beside the chart so a screen reader reaches it without operating a tab.
 */

export interface SeriesTableColumn {
  key: string;
  label: string;
  values: readonly (number | null)[];
  /** Per-column formatter; defaults to a plain number. */
  format?: (value: number | null) => string;
}

export interface SeriesTableProps {
  caption: string;
  eras: readonly number[];
  eraStart: readonly number[];
  columns: readonly SeriesTableColumn[];
  /** Rendered visually hidden, for the screen-reader copy. */
  hidden?: boolean;
  /** Cap rows so a 1,700-era range does not render 1,700 DOM rows. */
  maxRows?: number;
}

const defaultFormat = (value: number | null): string =>
  value == null
    ? '—'
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);

export function SeriesTable({
  caption,
  eras,
  eraStart,
  columns,
  hidden = false,
  maxRows = 400,
}: SeriesTableProps) {
  // Newest first: the recent end is what people look at, and it means a capped
  // table drops the oldest rows rather than the ones that matter.
  const indices = eras.map((_, i) => i).reverse();
  const shown = indices.slice(0, maxRows);
  const truncated = indices.length - shown.length;

  return (
    <div className={hidden ? 'sr-only' : undefined}>
      <table className="w-full border-collapse text-sm">
        <caption className="pb-2 text-left text-xs" style={{ color: 'var(--text-muted)' }}>
          {caption}
          {truncated > 0 ? ` (most recent ${shown.length} of ${indices.length} eras)` : null}
        </caption>
        <thead>
          <tr>
            <Th scope="col">Date</Th>
            <Th scope="col">Era</Th>
            {columns.map((column) => (
              <Th key={column.key} scope="col" numeric>
                {column.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((i) => (
            <tr key={eras[i]}>
              {/* The date is the row header: it is what identifies the row to a
                  reader, and the era index is the internal reference. */}
              <Th scope="row">{formatEraDate(eraStart[i], { withYear: true })}</Th>
              <Td>{eras[i]}</Td>
              {columns.map((column) => (
                <Td key={column.key} numeric>
                  {(column.format ?? defaultFormat)(column.values[i] ?? null)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  scope,
  numeric = false,
}: {
  children: React.ReactNode;
  scope: 'col' | 'row';
  numeric?: boolean;
}) {
  return (
    <th
      scope={scope}
      className={`border-b px-2 py-1.5 font-medium whitespace-nowrap ${
        numeric ? 'text-right' : 'text-left'
      }`}
      style={{
        borderColor: 'var(--border)',
        color: scope === 'col' ? 'var(--text-muted)' : 'var(--text-secondary)',
        // Sticky so column identity survives scrolling a long range.
        ...(scope === 'col'
          ? { position: 'sticky' as const, top: 0, background: 'var(--surface-1)', zIndex: 1 }
          : {}),
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, numeric = false }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <td
      className={`border-b px-2 py-1.5 whitespace-nowrap ${numeric ? 'text-right' : 'text-left'}`}
      style={{ borderColor: 'var(--border)' }}
    >
      {children}
    </td>
  );
}
