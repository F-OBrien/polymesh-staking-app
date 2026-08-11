import { describe, expect, it } from 'vitest';
import { pointsPerBlock, summariseProduction, type ProductionInput } from './production';

/**
 * A network of `operators` over `eras` eras, each era awarding `blocks` blocks
 * shared out according to `share` — a per-operator multiplier on the uniform
 * expectation, so `1` means "exactly average".
 */
function chain(shares: Record<string, number>, eras: number, blocksPerEra = 1000) {
  const addresses = Object.keys(shares);
  const total = Object.values(shares).reduce((a, b) => a + b, 0);

  const operators: ProductionInput['operators'] = Object.fromEntries(
    addresses.map((address) => [
      address,
      {
        points: Array.from(
          { length: eras },
          // Shares divide the era's blocks between the operators. Rounded to
          // whole blocks, as on chain, then paid at 20 points each.
          () => Math.round((blocksPerEra * (shares[address] as number)) / total) * 20,
        ),
      },
    ]),
  );

  // The era total is the sum of what was actually awarded, as the chain records
  // it — not the nominal slot count. Rounding above means the two can differ.
  const network = {
    totalPoints: Array.from({ length: eras }, (_, i) =>
      addresses.reduce((sum, a) => sum + ((operators[a]?.points[i] as number) ?? 0), 0),
    ),
    activeOperators: Array.from({ length: eras }, () => addresses.length),
  };

  return {
    eras: Array.from({ length: eras }, (_, i) => 1000 + i),
    network,
    operators,
    // Fixed, so the maths under test is not entangled with recovering the
    // award from a fixture too uniform for a GCD to read. `pointsPerBlock` has
    // its own tests above.
    awardPerBlock: 20,
  };
}

describe('pointsPerBlock', () => {
  it('recovers the award from the greatest common divisor', () => {
    // Every point total on Polymesh mainnet is a multiple of 20.
    expect(pointsPerBlock([3260, 3760, 2960, 1420])).toBe(20);
  });

  it('ignores zeros and non-finite values rather than collapsing to 1', () => {
    expect(pointsPerBlock([0, 40, Number.NaN, 60])).toBe(20);
  });

  it('falls back to 1 when there is nothing to divide', () => {
    expect(pointsPerBlock([])).toBe(1);
  });
});

describe('summariseProduction', () => {
  it('reports a ratio of one for an operator on the expectation', () => {
    const summary = summariseProduction(chain({ a: 1, b: 1, c: 1 }, 10));
    for (const record of summary.records) {
      expect(record.ratio).toBeCloseTo(1, 6);
      expect(record.z).toBeCloseTo(0, 6);
    }
  });

  it('ranks by ratio, best first', () => {
    const summary = summariseProduction(chain({ slow: 0.9, mid: 1, fast: 1.1 }, 30));
    expect(summary.records.map((r) => r.address)).toEqual(['fast', 'mid', 'slow']);
  });

  it('shrinks the standard error as eras accumulate', () => {
    // Four times the eras is four times the blocks, so half the relative error.
    const short = summariseProduction(chain({ a: 1, b: 1 }, 10)).records[0];
    const long = summariseProduction(chain({ a: 1, b: 1 }, 40)).records[0];
    expect(long?.standardError).toBeCloseTo((short?.standardError ?? 0) / 2, 4);
  });

  it('uses binomial rather than Poisson variance', () => {
    // With n validators sharing a fixed number of slots, an individual's count
    // is Binomial(N, 1/n): variance is λ(1 − 1/n), not λ. Poisson would
    // overstate the error and hide real outliers.
    const summary = summariseProduction(chain({ a: 1, b: 1, c: 1, d: 1 }, 1, 400));
    const record = summary.records[0];
    // Each operator expects 100 blocks of 400, with n = 4.
    expect(record?.standardError).toBeCloseTo(Math.sqrt(100 * (1 - 1 / 4)) / 100, 6);
  });

  it('separates the field spread into chance and genuine difference', () => {
    // A wide, deterministic spread over many eras: the standard errors are tiny,
    // so almost all of the observed spread must be attributed to the operators.
    const summary = summariseProduction(chain({ a: 0.8, b: 1, c: 1.2 }, 200));
    expect(summary.observedSpread).toBeGreaterThan(summary.luckSpread * 5);
    expect(summary.excessSpread).toBeCloseTo(summary.observedSpread, 2);
  });

  it('reports no excess spread when the field is uniform', () => {
    // Identical operators have zero observed spread, which cannot exceed the
    // error. Null is the honest answer, not zero — "we cannot tell" rather than
    // "we measured none".
    expect(summariseProduction(chain({ a: 1, b: 1, c: 1 }, 50)).excessSpread).toBeNull();
  });

  it('treats null points as absence from the set, not a zero score', () => {
    // The distinction the whole calculation turns on. Counting a null as zero
    // would report an operator that joined halfway through as having missed
    // every block before it existed.
    const base = chain({ a: 1, b: 1 }, 10);
    const joined = {
      ...base,
      operators: {
        ...base.operators,
        b: { points: base.operators.b!.points.map((p, i) => (i < 5 ? null : p)) },
      },
    };
    const summary = summariseProduction(joined);
    const b = summary.records.find((r) => r.address === 'b');
    expect(b?.eras).toBe(5);
    expect(b?.ratio).toBeCloseTo(1, 6);
  });

  it('drops operators present for less than the coverage threshold', () => {
    // Three eras of a ninety-era window carries an enormous error and would
    // otherwise sit at one end of the sorted field looking like a finding.
    const base = chain({ a: 1, b: 1 }, 20);
    const newcomer = {
      ...base,
      operators: {
        ...base.operators,
        b: { points: base.operators.b!.points.map((p, i) => (i < 18 ? null : p)) },
      },
    };
    expect(summariseProduction(newcomer).records.map((r) => r.address)).toEqual(['a']);
  });

  it('skips eras whose totals have not landed yet', () => {
    // The trailing chunk is written before the era completes.
    const base = chain({ a: 1, b: 1 }, 10);
    const partial = {
      ...base,
      network: {
        totalPoints: base.network.totalPoints.map((p, i) => (i > 7 ? 0 : p)),
        activeOperators: base.network.activeOperators,
      },
    };
    const summary = summariseProduction(partial);
    expect(summary.eras).toBe(8);
    expect(summary.records[0]?.eras).toBe(8);
  });

  it('returns an empty summary rather than throwing on no data', () => {
    const summary = summariseProduction({
      eras: [],
      network: { totalPoints: [], activeOperators: [] },
      operators: {},
    });
    expect(summary.records).toEqual([]);
    expect(summary.excessSpread).toBeNull();
  });
});
