'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { EmptyState } from '@/components/states';
import { formatNumber, formatPercent, formatPolyx, truncateAddress } from '@/lib/format';
import {
  filterRows,
  rowsToCsv,
  sortRows,
  type OperatorFilters,
  type OperatorRow,
  type SortDirection,
  type SortKey,
} from '@/lib/data/operator-rows';

/**
 * The operator directory.
 *
 * This is the page's primary content, above the charts, because a ranked table
 * is how anyone actually answers "who should I nominate?". The previous app had
 * no table at all — the only way to compare operators was a hundred overlapping
 * lines.
 *
 * Sorting and filtering are hand-rolled (see `lib/data/operator-rows.ts` for
 * why). At ~100 rows there is nothing to virtualise, and the logic being pure
 * means it is tested without a DOM.
 */

interface Column {
  key: SortKey | 'pin' | 'sparkline';
  label: string;
  /** Sortable columns carry a SortKey; the others do not. */
  sort?: SortKey;
  numeric?: boolean;
  /** Hidden below this viewport width, so the table stays readable on a phone. */
  hideBelow?: 'sm' | 'md' | 'lg';
  help?: string;
}

const COLUMNS: Column[] = [
  { key: 'pin', label: '' },
  { key: 'name', label: 'Operator', sort: 'name' },
  {
    key: 'aprMean',
    label: 'Return',
    sort: 'aprMean',
    numeric: true,
    help: 'Mean APR after commission across the selected range',
  },
  {
    key: 'aprStdDev',
    label: 'Steadiness',
    sort: 'aprStdDev',
    numeric: true,
    hideBelow: 'md',
    help: 'Standard deviation of per-era return — lower is steadier',
  },
  { key: 'commission', label: 'Commission', sort: 'commission', numeric: true },
  { key: 'totalStake', label: 'Stake', sort: 'totalStake', numeric: true },
  {
    key: 'selfStakeRatio',
    label: 'Self-stake',
    sort: 'selfStakeRatio',
    numeric: true,
    hideBelow: 'lg',
    help: "The operator's own share of its total stake",
  },
  {
    key: 'nominatorCount',
    label: 'Nominators',
    sort: 'nominatorCount',
    numeric: true,
    hideBelow: 'sm',
  },
  { key: 'sparkline', label: 'Trend', hideBelow: 'md' },
];

const HIDE_CLASS: Record<NonNullable<Column['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

export interface OperatorsTableProps {
  rows: readonly OperatorRow[];
  selectedSet: ReadonlySet<string>;
  onTogglePin: (address: string) => void;
  selectionFull: boolean;
  maxSelected: number;
  loading?: boolean;
}

export function OperatorsTable({
  rows,
  selectedSet,
  onTogglePin,
  selectionFull,
  maxSelected,
  loading = false,
}: OperatorsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('totalStake');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [filters, setFilters] = useState<OperatorFilters>({ status: 'active' });

  const visible = useMemo(
    () => sortRows(filterRows(rows, filters), sortKey, direction),
    [rows, filters, sortKey, direction],
  );

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // Numeric columns are almost always wanted largest-first; names are not.
    setDirection(key === 'name' ? 'asc' : 'desc');
  };

  const download = () => {
    const blob = new Blob([rowsToCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `polymesh-operators-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <Filters
        filters={filters}
        onChange={setFilters}
        total={rows.length}
        shown={visible.length}
        onExport={download}
      />

      {selectionFull ? (
        <p className="m-0 text-xs" style={{ color: 'var(--status-warning)' }}>
          <span aria-hidden="true">⚠ </span>
          {maxSelected} operators pinned — the palette holds that many distinguishable colours.
          Unpin one to add another.
        </p>
      ) : null}

      {visible.length === 0 && !loading ? (
        <EmptyState
          title="No operators match these filters"
          message="Try clearing the search, or widening the commission cap."
          action={
            <button
              type="button"
              className="mt-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => setFilters({ status: 'all' })}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Polymesh operators, sorted by {sortKey}{' '}
              {direction === 'asc' ? 'ascending' : 'descending'}.{visible.length} of {rows.length}{' '}
              shown.
            </caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <HeaderCell
                    key={column.key}
                    column={column}
                    active={column.sort === sortKey}
                    direction={direction}
                    onSort={column.sort ? () => toggleSort(column.sort!) : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <Row
                  key={row.address}
                  row={row}
                  pinned={selectedSet.has(row.address)}
                  onTogglePin={() => onTogglePin(row.address)}
                  pinDisabled={selectionFull && !selectedSet.has(row.address)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HeaderCell({
  column,
  active,
  direction,
  onSort,
}: {
  column: Column;
  active: boolean;
  direction: SortDirection;
  onSort?: (() => void) | undefined;
}) {
  const hide = column.hideBelow ? HIDE_CLASS[column.hideBelow] : '';

  return (
    <th
      scope="col"
      // `aria-sort` is what tells a screen-reader user the table is sorted and
      // by which column — the arrow glyph alone conveys nothing to them.
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`sticky top-0 z-10 border-b px-2 py-2 font-medium whitespace-nowrap ${
        column.numeric ? 'text-right' : 'text-left'
      } ${hide}`}
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-1)',
        color: 'var(--text-muted)',
      }}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          title={column.help ?? `Sort by ${column.label}`}
          className="inline-flex items-center gap-1 font-medium"
          style={{ color: active ? 'var(--text-primary)' : 'inherit' }}
        >
          {column.label}
          <span aria-hidden="true" style={{ opacity: active ? 1 : 0.3 }}>
            {active && direction === 'asc' ? '↑' : '↓'}
          </span>
        </button>
      ) : (
        <span title={column.help}>{column.label || <span className="sr-only">Pin</span>}</span>
      )}
    </th>
  );
}

function Row({
  row,
  pinned,
  onTogglePin,
  pinDisabled,
}: {
  row: OperatorRow;
  pinned: boolean;
  onTogglePin: () => void;
  pinDisabled: boolean;
}) {
  const cell = 'border-b px-2 py-2 whitespace-nowrap';
  const border = { borderColor: 'var(--border)' };

  return (
    <tr>
      <td className={cell} style={border}>
        <button
          type="button"
          onClick={onTogglePin}
          disabled={pinDisabled}
          aria-pressed={pinned}
          title={pinned ? `Unpin ${row.nodeLabel}` : `Pin ${row.nodeLabel} to the charts`}
          className="rounded px-1 leading-none disabled:cursor-not-allowed disabled:opacity-30"
          style={{ color: pinned ? 'var(--series-1)' : 'var(--text-muted)' }}
        >
          <span aria-hidden="true">{pinned ? '★' : '☆'}</span>
          <span className="sr-only">{pinned ? 'Pinned' : 'Pin to charts'}</span>
        </button>
      </td>

      <th scope="row" className={`${cell} text-left font-medium`} style={border}>
        <Link href={`/operators/${row.address}/`} className="no-underline hover:underline">
          {row.nodeLabel}
        </Link>
        <span className="ms-2 font-normal" style={{ color: 'var(--text-muted)' }}>
          {truncateAddress(row.address)}
        </span>
        <StatusFlags row={row} />
      </th>

      <Numeric>{formatPercent(row.aprMean, { decimals: 2 })}</Numeric>
      <Numeric hide="md">
        {row.aprStdDev == null ? '—' : `±${formatPercent(row.aprStdDev, { decimals: 2 })}`}
      </Numeric>
      <Numeric>{formatPercent(row.commission, { decimals: 1 })}</Numeric>
      <Numeric>{formatPolyx(row.totalStake, { compact: true })}</Numeric>
      <Numeric hide="lg">{formatPercent(row.selfStakeRatio, { decimals: 1 })}</Numeric>
      <Numeric hide="sm">{formatNumber(row.nominatorCount)}</Numeric>

      <td className={`${cell} ${HIDE_CLASS.md}`} style={border}>
        <Sparkline values={row.aprSeries} colour={pinned ? 'var(--series-1)' : undefined} />
      </td>
    </tr>
  );
}

function Numeric({ children, hide }: { children: React.ReactNode; hide?: 'sm' | 'md' | 'lg' }) {
  return (
    <td
      className={`border-b px-2 py-2 text-right whitespace-nowrap tabular ${hide ? HIDE_CLASS[hide] : ''}`}
      style={{ borderColor: 'var(--border)' }}
    >
      {children}
    </td>
  );
}

/**
 * Status badges.
 *
 * Oversubscription earns a warning because it is the difference between staking
 * and only appearing to stake — a nominator past the page limit earns nothing.
 * Icon plus text, never colour alone.
 */
function StatusFlags({ row }: { row: OperatorRow }) {
  const flags: { label: string; colour: string; title: string }[] = [];

  if (row.oversubscribed) {
    flags.push({
      label: 'full',
      colour: 'var(--status-warning)',
      title: 'Nominator page is full — new nominators may earn nothing',
    });
  }
  if (row.blocked) {
    flags.push({
      label: 'blocked',
      colour: 'var(--status-serious)',
      title: 'Operator has blocked further nominations',
    });
  }
  if (row.status === 'waiting') {
    flags.push({
      label: 'waiting',
      colour: 'var(--text-muted)',
      title: 'Declared an intention to validate but not elected this era',
    });
  }
  if (row.status === 'inactive') {
    flags.push({
      label: 'inactive',
      colour: 'var(--text-muted)',
      title: 'Not in the active set',
    });
  }

  if (flags.length === 0) return null;

  return (
    <>
      {flags.map((flag) => (
        <span
          key={flag.label}
          title={flag.title}
          className="ms-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-normal"
          style={{ borderColor: flag.colour, color: flag.colour }}
        >
          {flag.label}
        </span>
      ))}
    </>
  );
}

function Filters({
  filters,
  onChange,
  total,
  shown,
  onExport,
}: {
  filters: OperatorFilters;
  onChange: (next: OperatorFilters) => void;
  total: number;
  shown: number;
  onExport: () => void;
}) {
  const control = 'rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm';
  const style = { borderColor: 'var(--border)', background: 'var(--surface-1)' };

  return (
    // One row above the table, per the design doc's interaction rules.
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="operator-search">
        Search operators
      </label>
      <input
        id="operator-search"
        type="search"
        placeholder="Search name or address"
        className={`${control} min-w-[16rem] flex-1`}
        style={style}
        value={filters.search ?? ''}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
      />

      <label className="sr-only" htmlFor="operator-status">
        Status
      </label>
      <select
        id="operator-status"
        className={control}
        style={style}
        value={filters.status ?? 'all'}
        onChange={(e) =>
          onChange({ ...filters, status: e.target.value as OperatorFilters['status'] })
        }
      >
        <option value="active">Active</option>
        <option value="waiting">Waiting</option>
        <option value="inactive">Inactive</option>
        <option value="all">All statuses</option>
      </select>

      <label
        className="flex items-center gap-1.5 text-sm"
        style={{ color: 'var(--text-secondary)' }}
      >
        <input
          type="checkbox"
          checked={filters.hideOversubscribed ?? false}
          onChange={(e) => onChange({ ...filters, hideOversubscribed: e.target.checked })}
        />
        Hide full
      </label>

      <span className="ms-auto text-xs" style={{ color: 'var(--text-muted)' }}>
        {shown === total ? `${total} operators` : `${shown} of ${total}`}
      </span>

      <button type="button" onClick={onExport} className={control} style={style}>
        Export CSV
      </button>
    </div>
  );
}
