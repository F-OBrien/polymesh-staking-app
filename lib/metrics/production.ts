import type { NetworkSeries, OperatorSeries } from '@/lib/schemas/data';

/**
 * Block production measured against what the authorship lottery predicts.
 *
 * **Why this exists, and why the specced chart does not.** §8.3 lists C18 as
 * "current-era points by operator — horizontal bar, sorted, with an
 * expected-value reference line". Measured against mainnet, that chart is a
 * ranking of luck:
 *
 * - A third of the way into era 1750 the field spanned 800–1420 points, a
 *   coefficient of variation of **12.5%**. The variation a pure lottery would
 *   produce over the same number of blocks is **13.4%**. The observed spread
 *   was *smaller* than chance alone predicts.
 * - Over a *complete* era it is no better: era 1674, 90 operators, observed
 *   8.1% against a predicted 7.9%.
 *
 * Sorting that and drawing a reference line invites exactly the wrong reading —
 * that the operators at the bottom are underperforming, when they simply drew
 * fewer slots. So the question C18 asks ("who is producing?") is kept and the
 * form is changed: accumulate over the whole selected era range, where the
 * noise averages down, and report the ratio to expected *alongside the
 * uncertainty*, so "better than expected" can be distinguished from "lucky".
 *
 * Aggregated over eras 1664–1749 the signal is real but small. Measured
 * through this module: the field spreads ±1.38%, of which ±0.85% is the
 * lottery, leaving **±1.09%** of genuine operator-to-operator dispersion.
 * Ratios run 0.966 to 1.038 and 21 of 90 operators sit beyond two standard
 * errors — the best 4.5σ above expected, the worst 4.1σ below. Over the last
 * seven eras the same calculation leaves ±0.57% against ±2.90% of noise, which
 * is why callers are handed the split rather than left to assume any of the
 * spread is meaningful.
 *
 * **Expected is uniform, not stake-weighted.** Authorship slots are drawn per
 * validator, not per unit of stake. Measured on era 1750, the correlation
 * between points and total stake is 0.07 — and Polymesh's election equalises
 * exposure anyway, so there is barely any stake variation left to correlate
 * with. Expected points for an era is therefore that era's total divided by the
 * number of active operators.
 */

/**
 * Points awarded per authored block.
 *
 * Derived from the data rather than hardcoded to Substrate's 20: it is a
 * runtime constant that Polymesh could change, and a wrong value would silently
 * scale every standard error by its square root. Every point total observed on
 * mainnet is a multiple of 20, so the greatest common divisor recovers it.
 *
 * **It needs variety to work.** The GCD of a handful of identical totals is
 * that total, which would report every operator as having authored one block
 * and inflate the error tenfold. Real input is 86 operators over 86 eras and
 * cannot be that uniform — the odds of every total sharing a factor of 40 are
 * astronomical — but that is a property of the data, not of this function, so
 * `summariseProduction` takes the divisor as an injectable override.
 */
export function pointsPerBlock(values: Iterable<number>): number {
  let divisor = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) continue;
    divisor = gcd(divisor, Math.round(value));
  }
  return divisor > 0 ? divisor : 1;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

export interface ProductionRecord {
  address: string;
  /** Eras in which this operator was in the active set. */
  eras: number;
  /** Points actually earned across those eras. */
  points: number;
  /** Points the authorship lottery predicts over the same eras. */
  expected: number;
  /** `points / expected`. One means exactly as predicted. */
  ratio: number;
  /**
   * One standard error on `ratio`, from the lottery alone.
   *
   * Authorship over an era is a draw of `N` slots shared among `n` validators,
   * so an individual's block count is Binomial(N, 1/n) — variance
   * `λ(1 − 1/n)`, not Poisson's `λ`. With 86 validators the correction is only
   * 0.6%, but it costs one term and removes an approximation from a number
   * whose whole job is to say what counts as significant.
   */
  standardError: number;
  /** Signed distance from expected, in standard errors. */
  z: number;
}

export interface ProductionSummary {
  records: ProductionRecord[];
  /** Eras the calculation actually covered. */
  eras: number;
  /**
   * Spread of `ratio` across the field, as a standard deviation.
   *
   * Compare against `luckSpread`: if they are equal, the whole chart is noise.
   */
  observedSpread: number;
  /** The spread the lottery alone would produce, as a standard deviation. */
  luckSpread: number;
  /**
   * Dispersion left once the lottery is subtracted, or null when the observed
   * spread does not exceed it — which is the honest answer for a short range.
   */
  excessSpread: number | null;
}

export interface ProductionInput {
  eras: readonly number[];
  network: Pick<NetworkSeries, 'totalPoints' | 'activeOperators'>;
  operators: Readonly<Record<string, Pick<OperatorSeries, 'points'>>>;
  /**
   * Drop operators present for less than this fraction of the range.
   *
   * An operator that joined for the last three eras of a ninety-era window has
   * an enormous standard error and would dominate both ends of a sorted chart.
   */
  minCoverage?: number;
  /** Overrides the GCD-derived award per block. See `pointsPerBlock`. */
  awardPerBlock?: number;
}

const DEFAULT_MIN_COVERAGE = 0.5;

export function summariseProduction({
  eras,
  network,
  operators,
  minCoverage = DEFAULT_MIN_COVERAGE,
  awardPerBlock,
}: ProductionInput): ProductionSummary {
  const empty: ProductionSummary = {
    records: [],
    eras: 0,
    observedSpread: 0,
    luckSpread: 0,
    excessSpread: null,
  };
  if (eras.length === 0) return empty;

  const perBlock =
    awardPerBlock ??
    pointsPerBlock(
      Object.values(operators).flatMap((operator) =>
        operator.points.filter((p): p is number => p != null),
      ),
    );

  // Eras with a usable denominator. A chunk still being written can carry an
  // era whose totals have not landed.
  const usable: number[] = [];
  for (let i = 0; i < eras.length; i += 1) {
    const total = network.totalPoints[i];
    const active = network.activeOperators[i];
    if (total != null && total > 0 && active != null && active > 0) usable.push(i);
  }
  if (usable.length === 0) return empty;

  const records: ProductionRecord[] = [];

  for (const [address, operator] of Object.entries(operators)) {
    let points = 0;
    let expected = 0;
    let count = 0;
    // Variance accumulates in *blocks*, era by era, because the number of
    // validators sharing the slots changes as the set changes.
    let variance = 0;

    for (const i of usable) {
      const scored = operator.points[i];
      // Null is "not in the active set that era" — the ingest writes null, not
      // zero, and stake is null alongside it. A genuine zero would be an
      // operator that was elected and produced nothing, which counts.
      if (scored == null) continue;

      const active = network.activeOperators[i] as number;
      const eraExpected = (network.totalPoints[i] as number) / active;

      points += scored;
      expected += eraExpected;
      count += 1;
      variance += (eraExpected / perBlock) * (1 - 1 / active);
    }

    if (count < usable.length * minCoverage || expected <= 0) continue;

    const expectedBlocks = expected / perBlock;
    records.push({
      address,
      eras: count,
      points,
      expected,
      ratio: points / expected,
      // Blocks are the unit the variance is defined in; dividing by the
      // expected block count turns it back into a relative error on the ratio.
      standardError: Math.sqrt(variance) / expectedBlocks,
      z: 0,
    });
  }

  for (const record of records) {
    record.z = record.standardError > 0 ? (record.ratio - 1) / record.standardError : 0;
  }

  records.sort((a, b) => b.ratio - a.ratio);

  const observedSpread = standardDeviation(records.map((r) => r.ratio));
  const luckSpread = rootMeanSquare(records.map((r) => r.standardError));

  return {
    records,
    eras: usable.length,
    observedSpread,
    luckSpread,
    // Variances subtract, standard deviations do not.
    excessSpread:
      observedSpread > luckSpread
        ? Math.sqrt(observedSpread * observedSpread - luckSpread * luckSpread)
        : null,
  };
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

function rootMeanSquare(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length);
}
