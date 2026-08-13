'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { InfoTip } from '@/components/info-tip';
import { EmptyState } from '@/components/states';
import { formatNumber, formatPercent, formatPolyx } from '@/lib/format';
import { CopyAddress } from '@/components/copy-address';
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

/**
 * Whether returns are shown before or after the operator's commission.
 *
 * One control for the whole table rather than a per-column choice: the columns
 * exist to be compared with each other, and comparing a gross figure against a
 * net one is the mistake the control is there to prevent.
 */
export type CommissionBasis = 'net' | 'gross';

interface Column {
  key: string;
  label: string;
  /** Sortable columns carry a SortKey; the others do not. */
  sort?: SortKey;
  /** Return columns sort on a different field depending on the basis. */
  sortByBasis?: Record<CommissionBasis, SortKey>;
  numeric?: boolean;
  /** Hidden below this viewport width, so the table stays readable on a phone. */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Rendered into an ⓘ beside the header. */
  help?: React.ReactNode;
  /** Short suffix under the label, e.g. the era a column refers to. */
  note?: string;
}

/**
 * Columns.
 *
 * There were three separate problems with the single `Return` column this
 * replaces, and they compounded. It did not say what period it covered (a mean
 * over whatever era range happened to be selected). It did not say whether
 * commission had been taken off. And by being backward-looking only, it could
 * not answer the question people actually open the page with — is this node
 * working right now, and what will it pay me next.
 *
 * Three columns, each named for its period, plus a basis toggle that names the
 * commission treatment once for all of them.
 */
function columns({ basis, rangeEras, lastEra, eraProgress }: ColumnContext): Column[] {
  const suffix = basis === 'net' ? 'after commission' : 'before commission';
  const elapsed = eraProgress == null ? null : Math.round(eraProgress * 100);

  return [
    { key: 'pin', label: '' },
    { key: 'name', label: 'Operator', sort: 'name' },
    {
      key: 'thisEra',
      // How far into the era we are is part of reading this number, not a
      // detail: at 5% elapsed it is barely more than noise, at 90% it is nearly
      // settled. Ticks locally from the tier-3 clock, costing no network.
      note: elapsed == null ? 'est.' : `est. · ${elapsed}% in`,
      label: 'This era',
      sortByBasis: { net: 'aprThisEra', gross: 'aprThisEraGross' },
      numeric: true,
      help: (
        <>
          <strong>Forward-looking.</strong> Annualised return implied by the points this operator
          has scored so far in the era now running, against the stake currently backing it —{' '}
          {suffix}.
          <br />
          <br />A share of points is meaningful before an era ends even though the count is not,
          because points accrue roughly evenly. But block authorship is random in the short run, so
          the figure is noisy early on and firms up through the day.
          {/* "Only 92% elapsed" would be nonsense; the reading changes with
              the number, so the sentence has to as well. */}
          {elapsed == null
            ? ''
            : elapsed >= 60
              ? ` The era is ${elapsed}% elapsed, so this is close to settled.`
              : ` The era is just ${elapsed}% elapsed, so treat it as a rough signal.`}{' '}
          Either way, sorting by it puts the operators that have been <em>lucky</em> so far near the
          top alongside the ones genuinely performing — compare against Last era and Typical era
          before reading much into it.
          <br />
          <br />
          Turn on Live to have it update as each block arrives rather than every 15 minutes.
        </>
      ),
    },
    {
      key: 'lastEra',
      label: 'Last era',
      ...(lastEra != null ? { note: `era ${lastEra}` } : {}),
      sortByBasis: { net: 'aprLastEra', gross: 'aprLastEraGross' },
      numeric: true,
      hideBelow: 'sm',
      help: (
        <>
          <strong>Actual, not estimated.</strong> What this operator returned over the most recent
          complete era{lastEra != null ? ` (${lastEra})` : ''}, {suffix}. This is the figure the
          Polymesh Portal shows.
        </>
      ),
    },
    {
      key: 'typical',
      label: 'Typical era',
      ...(rangeEras != null ? { note: `${rangeEras} eras` } : {}),
      sortByBasis: { net: 'aprMedian', gross: 'aprMedianGross' },
      numeric: true,
      help: (
        <>
          <strong>The long view.</strong> The middle of the per-era returns across the era range
          selected above{rangeEras != null ? ` — ${rangeEras} eras` : ''}, {suffix}. A median rather
          than an average, because an operator&rsquo;s first era in the set pays on its own bond
          with no nominators: one Huobi node earning 18–25% all year averaged 48.59% on the strength
          of a single era that paid 2,474%.
        </>
      ),
    },
    {
      key: 'aprSpread',
      label: 'Steadiness',
      sortByBasis: { net: 'aprSpread', gross: 'aprSpreadGross' },
      numeric: true,
      hideBelow: 'md',
      help: (
        <>
          How far a typical era sits from this operator&rsquo;s middle, over the selected range —
          lower is steadier. Two operators with the same typical return are not equivalent if one of
          them halves some weeks. Measured robustly, like the column beside it: squaring the
          deviations let one first era report a steady node as &plusmn;188%.
        </>
      ),
    },
    {
      key: 'pointsThisEra',
      label: 'Points',
      note: 'this era',
      sort: 'pointsThisEra',
      numeric: true,
      hideBelow: 'lg',
      help: (
        <>
          Reward points scored so far in the era now running. Rising points mean the node is
          producing blocks; a flat zero well into an era means it is not. With Live on this updates
          every block, which is the quickest confirmation that an operator is healthy.
        </>
      ),
    },
    { key: 'commission', label: 'Commission', sort: 'commission', numeric: true },
    { key: 'totalStake', label: 'Stake', sort: 'totalStake', numeric: true, hideBelow: 'md' },
    {
      key: 'selfStakeRatio',
      label: 'Self-stake',
      sort: 'selfStakeRatio',
      numeric: true,
      hideBelow: 'lg',
      help: (
        <>
          The operator&rsquo;s own share of its total stake — its skin in the game, and the only
          part of the stake that Polymesh slashing can touch.
        </>
      ),
    },
    {
      key: 'nominatorCount',
      label: 'Nominators',
      sort: 'nominatorCount',
      numeric: true,
      hideBelow: 'lg',
    },
    { key: 'sparkline', label: 'Trend', hideBelow: 'md' },
  ];
}

interface ColumnContext {
  basis: CommissionBasis;
  rangeEras: number | null;
  lastEra: number | null;
  /** 0–1 through the era now running, or null before the snapshot lands. */
  eraProgress: number | null;
}

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
  /** Eras in the selected range, so the Typical era column can say how many. */
  rangeEras?: number | null;
  /** 0–1 through the current era, for reading the estimate honestly. */
  eraProgress?: number | null;
  /** Slot for the Live toggle, which drives the two current-era columns. */
  liveControl?: React.ReactNode;
  /** Unpins everything. Rendered next to the pin count when anything is pinned. */
  onClearPins?: (() => void) | undefined;
}

export function OperatorsTable({
  rows,
  selectedSet,
  onTogglePin,
  selectionFull,
  maxSelected,
  loading = false,
  rangeEras = null,
  eraProgress = null,
  liveControl,
  onClearPins,
}: OperatorsTableProps) {
  // Default sort is this era's estimated return: the table exists to answer
  // "who should I nominate?", and stake — the old default — is nearly identical
  // across the whole field because the election equalises it.
  const [sortKey, setSortKey] = useState<SortKey>('aprThisEra');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [filters, setFilters] = useState<OperatorFilters>({ status: 'active' });
  const [basis, setBasis] = useState<CommissionBasis>('net');

  const lastEra = useMemo(() => {
    for (const row of rows) if (row.lastEraIndex != null) return row.lastEraIndex;
    return null;
  }, [rows]);

  const cols = useMemo(
    () => columns({ basis, rangeEras, lastEra, eraProgress }),
    [basis, rangeEras, lastEra, eraProgress],
  );

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

  const changeBasis = (next: CommissionBasis) => {
    setBasis(next);
    // Follow the sort to the same *column* on the new basis. Without this,
    // flipping to gross while sorted by net return silently reorders by a
    // column that is no longer on screen.
    const active = cols.find((c) => c.sortByBasis && c.sortByBasis[basis] === sortKey);
    if (active?.sortByBasis) setSortKey(active.sortByBasis[next]);
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
        basis={basis}
        onBasisChange={changeBasis}
        liveControl={liveControl}
        pinnedCount={selectedSet.size}
        onClearPins={onClearPins}
      />

      {selectionFull ? (
        <p className="m-0 text-xs" style={{ color: 'var(--status-warning)' }}>
          <span aria-hidden="true">⚠ </span>
          {maxSelected} pinned — that is the maximum. Unpin one to add another.
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
                {cols.map((column) => {
                  const sort = column.sortByBasis?.[basis] ?? column.sort;
                  return (
                    <HeaderCell
                      key={column.key}
                      column={column}
                      active={sort === sortKey}
                      direction={direction}
                      onSort={sort ? () => toggleSort(sort) : undefined}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <Row
                  key={row.address}
                  row={row}
                  basis={basis}
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
      <span className={`inline-flex items-center gap-1 ${column.numeric ? 'justify-end' : ''}`}>
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            title={`Sort by ${column.label}`}
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: active ? 'var(--text-primary)' : 'inherit' }}
          >
            {column.label}
            <span aria-hidden="true" style={{ opacity: active ? 1 : 0.3 }}>
              {active && direction === 'asc' ? '↑' : '↓'}
            </span>
          </button>
        ) : (
          <span>{column.label || <span className="sr-only">Pin</span>}</span>
        )}
        {/* The explanation lives behind an ⓘ rather than in a `title`, which is
            unreachable by keyboard and invisible on touch. */}
        {column.help ? <InfoTip label={`About ${column.label}`}>{column.help}</InfoTip> : null}
      </span>
      {/* The period a column covers is part of its identity, not a footnote —
          "Return" meaning three different things was the original problem. */}
      {column.note ? (
        <span
          className="block text-[10px] font-normal"
          style={{ color: 'var(--text-muted)', opacity: 0.8 }}
        >
          {column.note}
        </span>
      ) : null}
    </th>
  );
}

function Row({
  row,
  basis,
  pinned,
  onTogglePin,
  pinDisabled,
}: {
  row: OperatorRow;
  basis: CommissionBasis;
  pinned: boolean;
  onTogglePin: () => void;
  pinDisabled: boolean;
}) {
  const net = basis === 'net';
  const thisEra = net ? row.aprThisEra : row.aprThisEraGross;
  const lastEra = net ? row.aprLastEra : row.aprLastEraGross;
  const typicalApr = net ? row.aprMedian : row.aprMedianGross;
  const spread = net ? row.aprSpread : row.aprSpreadGross;
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
          title={pinned ? `Unpin ${row.name}` : `Pin ${row.name} to the charts`}
          className="rounded px-1 leading-none disabled:cursor-not-allowed disabled:opacity-30"
          style={{ color: pinned ? 'var(--series-1)' : 'var(--text-muted)' }}
        >
          <span aria-hidden="true">{pinned ? '★' : '☆'}</span>
          <span className="sr-only">{pinned ? 'Pinned' : 'Pin to charts'}</span>
        </button>
      </td>

      <th scope="row" className={`${cell} text-left font-medium`} style={border}>
        <Link href={`/operators/${row.address}/`} className="no-underline hover:underline">
          {row.name}
        </Link>
        <CopyAddress
          address={row.address}
          label={row.name}
          className="ms-2 align-middle font-normal"
        />
        <StatusFlags row={row} />
      </th>

      <Numeric>{formatPercent(thisEra, { decimals: 2 })}</Numeric>
      <Numeric hide="sm">{formatPercent(lastEra, { decimals: 2 })}</Numeric>
      <Numeric>{formatPercent(typicalApr, { decimals: 2 })}</Numeric>
      <Numeric hide="md">
        {spread == null ? '—' : `±${formatPercent(spread, { decimals: 2 })}`}
      </Numeric>
      <Numeric hide="lg">{formatNumber(row.pointsThisEra)}</Numeric>
      <Numeric>{formatPercent(row.commission, { decimals: 1 })}</Numeric>
      <Numeric hide="md">{formatPolyx(row.totalStake, { compact: true })}</Numeric>
      <Numeric hide="lg">{formatPercent(row.selfStakeRatio, { decimals: 1 })}</Numeric>
      <Numeric hide="lg">{formatNumber(row.nominatorCount)}</Numeric>

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
 * Status badges. Icon plus text, never colour alone.
 *
 * There used to be a "full" badge here for any operator with more than 64
 * nominators, warning that new ones "may earn nothing". It was wrong: Polymesh
 * uses paged exposures, every page is rewarded, and the chain pays each page
 * automatically. A badge that tells people to avoid the most-nominated
 * operators is worse than no badge, so it is gone rather than reworded — see
 * the note on `pageCount` in `lib/schemas/data.ts`.
 */
function StatusFlags({ row }: { row: OperatorRow }) {
  const flags: { label: string; colour: string; title: string }[] = [];

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
  basis,
  onBasisChange,
  liveControl,
  pinnedCount,
  onClearPins,
}: {
  filters: OperatorFilters;
  onChange: (next: OperatorFilters) => void;
  total: number;
  shown: number;
  onExport: () => void;
  basis: CommissionBasis;
  onBasisChange: (next: CommissionBasis) => void;
  liveControl?: React.ReactNode;
  pinnedCount: number;
  onClearPins?: (() => void) | undefined;
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

      {/* Which commission basis every return column is on. Stated once, as a
          control rather than a footnote, because it is the single most common
          way two staking sites appear to disagree about the same operator. */}
      <label className="sr-only" htmlFor="operator-basis">
        Commission basis for returns
      </label>
      <select
        id="operator-basis"
        className={control}
        style={style}
        value={basis}
        onChange={(e) => onBasisChange(e.target.value as CommissionBasis)}
      >
        <option value="net">Returns after commission</option>
        <option value="gross">Returns before commission</option>
      </select>

      {liveControl}

      {/* Unpinning was previously only a muted text link in a sentence above
          the filter row — far from the ★ column, and easy to miss once a few
          were pinned. A real button, in the row of controls, beside the thing
          it undoes. */}
      {pinnedCount > 0 && onClearPins ? (
        <button
          type="button"
          onClick={onClearPins}
          className={control}
          style={style}
          title="Remove every pinned operator from the charts"
        >
          <span aria-hidden="true">☆ </span>
          Unpin all ({pinnedCount})
        </button>
      ) : null}

      <span className="ms-auto text-xs" style={{ color: 'var(--text-muted)' }}>
        {shown === total ? `${total} operators` : `${shown} of ${total}`}
      </span>

      <button type="button" onClick={onExport} className={control} style={style}>
        Export CSV
      </button>
    </div>
  );
}
