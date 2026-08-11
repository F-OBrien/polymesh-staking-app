import { deriveEstimatedEraApr, deriveOperatorApr, lastDefinedAt } from '@/lib/metrics/derive';
import { mean, stdDev } from '@/lib/metrics/stats';
import type { Latest, OperatorRegistry } from '@/lib/schemas/data';
import type { StitchedSeries } from './series';

/**
 * Building, sorting and filtering the operator directory.
 *
 * The sortable table is the single most useful artefact on a staking site — it
 * is how anyone actually answers "who should I nominate?" — and the previous
 * app had none. All of the logic lives here as pure functions so it can be
 * tested without a DOM, and so the component stays presentational.
 *
 * **Deliberately hand-rolled rather than using TanStack Table**, deviating from
 * the design doc's §6.8. Three reasons, in order: v9 is a feature-composition
 * rewrite with a very different and sparsely documented API; the directory is
 * ~100 rows, so virtualisation and windowing buy nothing; and the critical-path
 * budget is tight enough that 15 KB for sorting a hundred rows is a poor trade.
 * Revisit if the table ever needs grouping, pinning or column resizing.
 */

export interface OperatorRow {
  address: string;
  name: string;
  nodeLabel: string;
  status: 'active' | 'waiting' | 'inactive';
  /** null where the operator has no current snapshot entry. */
  commission: number | null;
  totalStake: number | null;
  ownStake: number | null;
  /** Own stake as a share of total — skin in the game. */
  selfStakeRatio: number | null;
  nominatorCount: number | null;
  /**
   * Exposure pages the operator's backers were split across.
   *
   * Carried for the CSV export only. It is a payout mechanic with no
   * consequence for a nominator on Polymesh, so nothing renders it as a status
   * — see the note on `pageCount` in `lib/schemas/data.ts`.
   */
  pageCount: number | null;
  blocked: boolean;
  /**
   * Return, on three time bases and two commission bases.
   *
   * "Return" on its own is the site's most-asked-about number and was also its
   * vaguest: a single column labelled `Return` was a *mean over the selected
   * era range, after commission*, and said none of that. Three quantities were
   * being conflated — what this operator is earning right now, what it earned
   * last era, and what it has averaged — and they differ enough to change a
   * nomination.
   *
   * So each is carried separately and labelled, and each exists gross and net,
   * because whether commission has been taken off moves the number by up to a
   * fifth. `…Gross` is before commission (node performance); the unsuffixed
   * field is after commission (what a nominator receives).
   */

  /** Estimated from points scored so far in the era now running. Forward-looking. */
  aprThisEra: number | null;
  aprThisEraGross: number | null;
  /** Actual, for the most recent complete era held. */
  aprLastEra: number | null;
  aprLastEraGross: number | null;
  /** Which era `aprLastEra` refers to, so the column can name it. */
  lastEraIndex: number | null;
  /** Mean across the visible era range. */
  aprMean: number | null;
  aprMeanGross: number | null;
  /**
   * Standard deviation of per-era APR. Lower is steadier.
   *
   * Presented as "consistency" rather than raw σ: two operators with the same
   * average return are not equivalent if one of them halves some weeks.
   */
  aprStdDev: number | null;
  aprStdDevGross: number | null;
  /** Points scored so far in the era now running, from the snapshot or Live. */
  pointsThisEra: number | null;
  /** Eras present in the visible range, for the sparkline. */
  aprSeries: (number | null)[];
  /** Share of reward points in the most recent era with data. */
  pointsShare: number | null;
}

export interface BuildRowsInput {
  series: StitchedSeries | null;
  latest: Latest | undefined;
  registry: OperatorRegistry | undefined;
  erasPerYear: number;
  /**
   * Tier-4 points for the era in progress, when the reader has Live on.
   *
   * Overrides the snapshot's points, which are up to 15 minutes old. That
   * staleness is invisible on a mean over 90 eras and very visible on "is my
   * node producing blocks right now", which is the question this answers.
   */
  livePoints?: { total: number; byOperator: Record<string, number> } | null | undefined;
}

const lastDefined = (values: readonly (number | null)[]): number | null => {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
};

/**
 * Assembles one row per operator seen in either the range or the snapshot.
 *
 * The union matters: an operator elected today may have no history in a short
 * range, and one with history may have dropped out. Showing only the
 * intersection would silently hide both.
 */
export function buildOperatorRows({
  series,
  latest,
  registry,
  erasPerYear,
  livePoints,
}: BuildRowsInput): OperatorRow[] {
  const bySnapshot = new Map((latest?.operators ?? []).map((op) => [op.address, op]));
  const addresses = new Set<string>([
    ...Object.keys(series?.operators ?? {}),
    ...bySnapshot.keys(),
  ]);

  // Inputs to the current-era estimate, shared by every row. Points come from
  // Live when it is on and the snapshot otherwise; the two are the same
  // quantity read at different freshness, so the estimate is identical in shape
  // either way and simply becomes exact.
  const snapshotTotalPoints = (latest?.operators ?? []).reduce((sum, op) => sum + op.points, 0);
  const eraTotalPoints = livePoints?.total ?? snapshotTotalPoints;
  const inflation = latest?.inflation ?? 0;
  const issuancePolyx = latest ? Number(BigInt(latest.totalIssuance) / 1_000_000n) : 0;

  const rows: OperatorRow[] = [];

  for (const address of addresses) {
    const record = registry?.[address];
    const snapshot = bySnapshot.get(address);
    const columns = series?.operators[address];

    const apr =
      columns && series
        ? deriveOperatorApr(columns, series.network, erasPerYear)
        : { gross: [], net: [] };
    const aprSeries = apr.net;

    // Snapshot values are exact base-unit strings; the range gives POLYX
    // floats. Prefer the snapshot for "now" figures and fall back to the last
    // era we hold, so a row is never blank just because the snapshot lagged.
    const totalStake = snapshot
      ? Number(BigInt(snapshot.totalStake) / 1_000_000n)
      : (lastDefined(columns?.totalStake ?? []) ?? null);
    const ownStake = snapshot
      ? Number(BigInt(snapshot.ownStake) / 1_000_000n)
      : (lastDefined(columns?.ownStake ?? []) ?? null);

    const pointsShare = (() => {
      if (!series || !columns) return null;
      for (let i = series.eras.length - 1; i >= 0; i -= 1) {
        const points = columns.points[i];
        const total = series.network.totalPoints[i];
        if (points != null && total != null && total > 0) return points / total;
      }
      return null;
    })();

    const commission = snapshot?.commission ?? lastDefined(columns?.commission ?? []);

    // "Last era" is the newest era actually held, which is the newest complete
    // one for every range preset. Named in the column header rather than left
    // implicit, because a stale ingest would otherwise pass for yesterday.
    const lastNet = lastDefinedAt(apr.net);
    const lastGross = lastDefinedAt(apr.gross);

    const pointsThisEra = livePoints
      ? (livePoints.byOperator[address] ?? null)
      : (snapshot?.points ?? null);

    const thisEra = deriveEstimatedEraApr({
      points: pointsThisEra,
      totalPoints: eraTotalPoints,
      totalStake,
      commission,
      inflation,
      totalIssuance: issuancePolyx,
    });

    rows.push({
      address,
      name: record?.name ?? address,
      nodeLabel: record?.nodeLabel ?? record?.name ?? address,
      status: record?.status ?? (snapshot?.elected ? 'active' : 'inactive'),
      commission,
      totalStake,
      ownStake,
      selfStakeRatio: totalStake != null && totalStake > 0 && ownStake != null ? ownStake / totalStake : null,
      nominatorCount: snapshot?.nominatorCount ?? lastDefined(columns?.nominatorCount ?? []),
      pageCount: snapshot?.pageCount ?? null,
      blocked: snapshot?.blocked ?? false,
      aprThisEra: thisEra.net,
      aprThisEraGross: thisEra.gross,
      aprLastEra: lastNet?.value ?? null,
      aprLastEraGross: lastGross?.value ?? null,
      lastEraIndex: lastNet != null ? (series?.eras[lastNet.index] ?? null) : null,
      aprMean: mean(aprSeries),
      aprMeanGross: mean(apr.gross),
      aprStdDev: stdDev(aprSeries),
      aprStdDevGross: stdDev(apr.gross),
      pointsThisEra,
      aprSeries,
      pointsShare,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortKey =
  | 'name'
  | 'commission'
  | 'totalStake'
  | 'selfStakeRatio'
  | 'nominatorCount'
  | 'aprThisEra'
  | 'aprThisEraGross'
  | 'aprLastEra'
  | 'aprLastEraGross'
  | 'aprMean'
  | 'aprMeanGross'
  | 'aprStdDev'
  | 'aprStdDevGross'
  | 'pointsThisEra'
  | 'pointsShare';

export type SortDirection = 'asc' | 'desc';

/**
 * Sorts rows, always placing missing values last.
 *
 * A null is "unknown", not "worst": sorting by APR descending should not bury
 * a strong operator whose data has not loaded, nor float it to the top when
 * sorting ascending. Keeping unknowns at the bottom either way is the only
 * reading that does not mislead.
 */
export function sortRows(
  rows: readonly OperatorRow[],
  key: SortKey,
  direction: SortDirection,
): OperatorRow[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return sign * a.nodeLabel.localeCompare(b.nodeLabel, undefined, { numeric: true });
    }

    const left = a[key];
    const right = b[key];

    if (left == null && right == null) return a.nodeLabel.localeCompare(b.nodeLabel);
    if (left == null) return 1;
    if (right == null) return -1;
    if (left === right) return a.nodeLabel.localeCompare(b.nodeLabel);

    return sign * (left < right ? -1 : 1);
  });
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface OperatorFilters {
  /** Matched against name, node label and address, case-insensitively. */
  search?: string | undefined;
  status?: 'all' | 'active' | 'waiting' | 'inactive' | undefined;
  /** Maximum commission as a ratio; undefined means no cap. */
  maxCommission?: number | undefined;
  /** Restrict to a specific set, e.g. the connected wallet's nominations. */
  onlyAddresses?: ReadonlySet<string> | undefined;
}

export function filterRows(
  rows: readonly OperatorRow[],
  filters: OperatorFilters,
): OperatorRow[] {
  const needle = filters.search?.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.onlyAddresses && !filters.onlyAddresses.has(row.address)) return false;
    if (filters.status && filters.status !== 'all' && row.status !== filters.status) return false;

    if (filters.maxCommission != null) {
      // An unknown commission is not evidence of a low one, so it is excluded
      // when the user has asked for a cap.
      if (row.commission == null || row.commission > filters.maxCommission) return false;
    }

    if (needle) {
      const haystack = `${row.name} ${row.nodeLabel} ${row.address}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * CSV of the visible rows.
 *
 * Users want the numbers out — to check a figure, or for their own records on
 * a chain whose holders often have reporting obligations. The previous app
 * rendered to canvas, so its data was unreachable by any means.
 */
export function rowsToCsv(rows: readonly OperatorRow[]): string {
  const header = [
    'operator',
    'address',
    'status',
    'commission',
    'total_stake_polyx',
    'own_stake_polyx',
    'self_stake_ratio',
    'nominators',
    // Every return column is exported on both commission bases and named for
    // the period it covers. A bare `apr` column in a spreadsheet is exactly the
    // ambiguity this rework exists to remove.
    'apr_this_era_est_net',
    'apr_this_era_est_gross',
    'apr_last_era_net',
    'apr_last_era_gross',
    'last_era',
    'apr_range_mean_net',
    'apr_range_mean_gross',
    'apr_range_stddev_net',
    'points_this_era',
    'points_share',
    'exposure_pages',
  ];

  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const num = (value: number | null) => (value == null ? '' : String(value));

  const lines = rows.map((row) =>
    [
      escape(row.nodeLabel),
      row.address,
      row.status,
      num(row.commission),
      num(row.totalStake),
      num(row.ownStake),
      num(row.selfStakeRatio),
      num(row.nominatorCount),
      num(row.aprThisEra),
      num(row.aprThisEraGross),
      num(row.aprLastEra),
      num(row.aprLastEraGross),
      num(row.lastEraIndex),
      num(row.aprMean),
      num(row.aprMeanGross),
      num(row.aprStdDev),
      num(row.pointsThisEra),
      num(row.pointsShare),
      num(row.pageCount),
    ].join(','),
  );

  return [header.join(','), ...lines].join('\n');
}
