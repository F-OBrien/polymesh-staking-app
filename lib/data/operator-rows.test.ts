import { describe, expect, it } from 'vitest';
import {
  buildOperatorRows,
  filterRows,
  rowsToCsv,
  sortRows,
  type OperatorRow,
} from './operator-rows';
import { stitchChunks } from './series';
import type { Chunk, Latest, OperatorRegistry } from '@/lib/schemas/data';

function row(partial: Partial<OperatorRow> & { address: string }): OperatorRow {
  return {
    name: partial.address,
    nodeLabel: partial.address,
    status: 'active',
    commission: 0.1,
    totalStake: 1000,
    ownStake: 100,
    selfStakeRatio: 0.1,
    nominatorCount: 10,
    oversubscribed: false,
    blocked: false,
    aprMean: 0.2,
    aprStdDev: 0.01,
    aprSeries: [0.2],
    pointsShare: 0.01,
    ...partial,
  };
}

describe('sortRows', () => {
  const rows = [
    row({ address: 'b', nodeLabel: 'Beta', totalStake: 200 }),
    row({ address: 'a', nodeLabel: 'Alpha', totalStake: 300 }),
    row({ address: 'c', nodeLabel: 'Gamma', totalStake: 100 }),
  ];

  it('sorts numerically in both directions', () => {
    expect(sortRows(rows, 'totalStake', 'desc').map((r) => r.address)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, 'totalStake', 'asc').map((r) => r.address)).toEqual(['c', 'b', 'a']);
  });

  it('sorts names naturally, so "Node 2" precedes "Node 10"', () => {
    const named = [
      row({ address: '1', nodeLabel: 'Node 10' }),
      row({ address: '2', nodeLabel: 'Node 2' }),
    ];
    expect(sortRows(named, 'name', 'asc').map((r) => r.nodeLabel)).toEqual(['Node 2', 'Node 10']);
  });

  it('places unknown values last in BOTH directions', () => {
    // A null is "unknown", not "worst". Sorting descending must not bury an
    // operator whose data has not loaded, and ascending must not float it to
    // the top as though it were the best.
    const withGap = [
      row({ address: 'known-low', aprMean: 0.1 }),
      row({ address: 'unknown', aprMean: null }),
      row({ address: 'known-high', aprMean: 0.3 }),
    ];

    expect(sortRows(withGap, 'aprMean', 'desc').map((r) => r.address)).toEqual([
      'known-high',
      'known-low',
      'unknown',
    ]);
    expect(sortRows(withGap, 'aprMean', 'asc').map((r) => r.address)).toEqual([
      'known-low',
      'known-high',
      'unknown',
    ]);
  });

  it('breaks ties by name, so the order is stable rather than arbitrary', () => {
    const tied = [
      row({ address: 'z', nodeLabel: 'Zeta', totalStake: 100 }),
      row({ address: 'a', nodeLabel: 'Alpha', totalStake: 100 }),
    ];
    expect(sortRows(tied, 'totalStake', 'desc').map((r) => r.nodeLabel)).toEqual(['Alpha', 'Zeta']);
  });

  it('does not mutate its input', () => {
    const original = rows.map((r) => r.address);
    sortRows(rows, 'totalStake', 'asc');
    expect(rows.map((r) => r.address)).toEqual(original);
  });
});

describe('filterRows', () => {
  const rows = [
    row({ address: '2AbcDef', name: 'Assetera', nodeLabel: 'Assetera 1', commission: 0.05 }),
    row({ address: '2XyzGhi', name: 'Binance', nodeLabel: 'Binance 2', commission: 0.4 }),
    row({ address: '2QrsTuv', name: 'Scrypt', nodeLabel: 'Scrypt 1', status: 'waiting' }),
    row({ address: '2FullOp', name: 'Full', nodeLabel: 'Full 1', oversubscribed: true }),
  ];

  it('matches name, node label or address, case-insensitively', () => {
    expect(filterRows(rows, { search: 'assetera' }).map((r) => r.address)).toEqual(['2AbcDef']);
    expect(filterRows(rows, { search: 'binance 2' }).map((r) => r.address)).toEqual(['2XyzGhi']);
    expect(filterRows(rows, { search: '2QRSTUV' }).map((r) => r.address)).toEqual(['2QrsTuv']);
  });

  it('filters by status, with "all" as a pass-through', () => {
    expect(filterRows(rows, { status: 'waiting' }).map((r) => r.address)).toEqual(['2QrsTuv']);
    expect(filterRows(rows, { status: 'all' })).toHaveLength(rows.length);
  });

  it('caps commission and excludes unknowns from the cap', () => {
    // An unknown commission is not evidence of a low one.
    const withUnknown = [...rows, row({ address: '2Unknown', commission: null })];
    const capped = filterRows(withUnknown, { maxCommission: 0.1 }).map((r) => r.address);
    expect(capped).toContain('2AbcDef');
    expect(capped).not.toContain('2XyzGhi');
    expect(capped).not.toContain('2Unknown');
  });

  it('can hide operators whose nominator page is full', () => {
    // They pay a new nominator nothing, so this is the difference between
    // staking and only appearing to stake.
    expect(filterRows(rows, { hideOversubscribed: true }).map((r) => r.address)).not.toContain(
      '2FullOp',
    );
  });

  it('restricts to an explicit address set', () => {
    const only = new Set(['2AbcDef', '2QrsTuv']);
    expect(filterRows(rows, { onlyAddresses: only })).toHaveLength(2);
  });

  it('combines filters conjunctively', () => {
    const result = filterRows(rows, { search: 'a', status: 'active', maxCommission: 0.1 });
    expect(result.map((r) => r.address)).toEqual(['2AbcDef']);
  });

  it('returns everything for empty filters', () => {
    expect(filterRows(rows, {})).toHaveLength(rows.length);
    expect(filterRows(rows, { search: '   ' })).toHaveLength(rows.length);
  });
});

describe('buildOperatorRows', () => {
  const chunk = (): Chunk => {
    const eras = [1, 2];
    const fill = (v: number) => eras.map(() => v);
    return {
      from: 0,
      to: 31,
      eras: eras as [number, ...number[]],
      eraStart: eras.map((e) => e * 86_400),
      network: {
        totalStaked: fill(1000),
        totalIssuance: fill(2000),
        validatorReward: fill(100),
        totalPoints: fill(1000),
        activeOperators: fill(2),
        nominatorCount: fill(20),
        avgCommission: fill(0.1),
        avgApr: fill(0.2),
        aprP10: fill(0.1),
        aprP50: fill(0.2),
        aprP90: fill(0.3),
      },
      operators: {
        historic: {
          points: [500, 500],
          commission: [0.1, 0.1],
          totalStake: [500, 500],
          ownStake: [50, 50],
          nominatorCount: [5, 5],
        },
      },
      provenance: {
        specVersion: fill(8_000_000),
        exposureShape: eras.map(() => 'paged' as const),
        source: eras.map(() => 'live' as const),
      },
    };
  };

  const latest: Latest = {
    schemaVersion: 1,
    activeEra: 3,
    generatedAt: '2026-08-08T00:00:00.000Z',
    eraStatus: {
      currentEra: 3,
      eraStart: 0,
      eraStartSlot: '0',
      eraStartSessionIndex: 0,
      currentSlot: '0',
      currentSessionIndex: 0,
      epochIndex: 0,
      genesisSlot: '0',
      sessionsPerEra: 4,
      epochDurationBlocks: 3600,
      expectedBlockTimeMs: 6000,
      electionPhase: 'Off',
    },
    totalIssuance: '2000000000',
    totalStaked: '1000000000',
    stakingRatio: 0.5,
    inflation: 0.1,
    impliedApr: 0.2,
    validatorCount: { active: 2, waiting: 0, max: 10 },
    operators: [
      {
        address: 'newcomer',
        points: 10,
        commission: 0.25,
        totalStake: '800000000',
        ownStake: '200000000',
        nominatorCount: 42,
        oversubscribed: true,
        pageCount: 2,
        blocked: false,
        elected: true,
      },
    ],
  };

  const registry: OperatorRegistry = {
    historic: {
      did: null,
      name: 'Historic',
      nodeLabel: 'Historic 1',
      website: null,
      firstSeenEra: 1,
      lastSeenEra: 2,
      status: 'inactive',
    },
  };

  it('unions operators from the range and the snapshot', () => {
    // One has history but no snapshot entry; the other is elected today with
    // no history in this range. Showing only the intersection hides both.
    const series = stitchChunks([chunk()]);
    const rows = buildOperatorRows({ series, latest, registry, erasPerYear: 365 });

    expect(rows.map((r) => r.address).sort()).toEqual(['historic', 'newcomer']);
  });

  it('prefers snapshot balances and converts them from base units', () => {
    const rows = buildOperatorRows({ series: null, latest, registry, erasPerYear: 365 });
    const newcomer = rows.find((r) => r.address === 'newcomer')!;

    expect(newcomer.totalStake).toBe(800);
    expect(newcomer.ownStake).toBe(200);
    expect(newcomer.selfStakeRatio).toBeCloseTo(0.25, 10);
    expect(newcomer.oversubscribed).toBe(true);
  });

  it('falls back to the last era held when there is no snapshot entry', () => {
    const series = stitchChunks([chunk()]);
    const rows = buildOperatorRows({ series, latest, registry, erasPerYear: 365 });
    const historic = rows.find((r) => r.address === 'historic')!;

    expect(historic.totalStake).toBe(500);
    expect(historic.commission).toBeCloseTo(0.1, 10);
  });

  it('derives mean and spread of APR across the range', () => {
    const series = stitchChunks([chunk()]);
    const rows = buildOperatorRows({ series, latest, registry, erasPerYear: 365 });
    const historic = rows.find((r) => r.address === 'historic')!;

    // Reward 100 * 500/1000 = 50 on stake 500 -> 0.1/era, net of 10%
    // commission -> 0.09, annualised by 365.
    expect(historic.aprMean).toBeCloseTo(0.09 * 365, 6);
    // Two identical eras: no spread.
    expect(historic.aprStdDev).toBeCloseTo(0, 10);
  });

  it('uses registry naming, falling back to the address', () => {
    const series = stitchChunks([chunk()]);
    const rows = buildOperatorRows({ series, latest, registry, erasPerYear: 365 });

    expect(rows.find((r) => r.address === 'historic')!.nodeLabel).toBe('Historic 1');
    // No registry entry: the address stands in rather than showing "undefined".
    expect(rows.find((r) => r.address === 'newcomer')!.nodeLabel).toBe('newcomer');
  });

  it('handles having no data at all', () => {
    expect(
      buildOperatorRows({ series: null, latest: undefined, registry: undefined, erasPerYear: 365 }),
    ).toEqual([]);
  });
});

describe('rowsToCsv', () => {
  it('emits a header and one line per row', () => {
    const csv = rowsToCsv([row({ address: 'a', nodeLabel: 'Alpha 1' })]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('operator,address,status');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Alpha 1');
  });

  it('quotes fields containing commas or quotes', () => {
    const csv = rowsToCsv([row({ address: 'a', nodeLabel: 'Smith, "Bob" & Co' })]);
    expect(csv).toContain('"Smith, ""Bob"" & Co"');
  });

  it('writes an empty field for an unknown value rather than "null"', () => {
    const csv = rowsToCsv([row({ address: 'a', nodeLabel: 'A', aprMean: null })]);
    expect(csv).not.toContain('null');
  });
});
