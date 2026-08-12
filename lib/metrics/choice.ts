import { deriveOperatorApr, type NullableNetwork } from './derive';
import type { OperatorSeries } from '@/lib/schemas/data';

/**
 * What backing *these* operators is worth, against backing the average one.
 *
 * A nominator's page is full of absolutes — earned so far, return to date,
 * network average — and none of them answers the question they are actually
 * holding: was picking these operators worth anything? A counterfactual does.
 *
 * **Forward-looking, and it has to be.** The obvious version is retrospective:
 * take every payout and ask what an average operator would have paid instead.
 * That cannot be built honestly here. The indexer's reward events carry no
 * validator — introspected, `StakingEvent` has `stashAccount`, `amount` and
 * `identityId` and nothing that says who paid — and the counterfactual also
 * needs the stake exposed in each past era, which would mean an archive read
 * per era. Both are outside what a static site can do. Inventing the answer
 * from today's stake and assuming it never changed would be a plausible-looking
 * number that is wrong for anyone who ever bonded more.
 *
 * So this compares the *current* nominations over the era range on screen, and
 * prices the gap against the stake actually assigned now. That is also the more
 * useful direction: a reader can change who they nominate, and cannot change
 * what they earned last March.
 *
 * **The split is the point.** The gap decomposes exactly:
 *
 *     net = gross x (1 - commission)
 *     net_you - net_field = (gross_you - gross_field)(1 - c_you)   <- production
 *                         - gross_field (c_you - c_field)          <- commission
 *
 * and on Polymesh these two terms are worth very different amounts. Block
 * production separates the field by about 1.1% in relative terms once slot luck
 * is removed (`lib/metrics/production.ts`), while commission runs from 8% to
 * 10% — a 2.2% swing in take-home, twice the size. A nominator chasing
 * performance is optimising the smaller term, and the split says so.
 */

export interface OperatorPick {
  address: string;
  /** Stake assigned to this operator, for weighting. Zero is fine. */
  weight: number;
}

export interface ChoiceInput {
  eras: readonly number[];
  network: NullableNetwork<'validatorReward' | 'totalPoints'>;
  operators: Readonly<Record<string, OperatorSeries>>;
  picks: readonly OperatorPick[];
  erasPerYear: number;
  /**
   * Fraction of the range an operator must have been active for to count.
   *
   * Every mean here weights operators equally, so without a floor an operator
   * present for three eras of eighty-six carries the same weight as one present
   * throughout. Measured on eras 1664-1749: one 3-era operator among the eight
   * lowest-commission ones reported that group's production as 0.94 points of
   * APR below the field. With the floor it is 0.23, and the group goes from
   * 0.50 points worse than the field overall to 0.19 points better — the
   * conclusion inverted, on one new operator's opening run.
   */
  minCoverage?: number;
}

const DEFAULT_MIN_COVERAGE = 0.5;

export interface ChoiceComparison {
  /** Eras with a usable figure for at least one pick. */
  eras: number;
  /** How many picks had any history in the range. */
  covered: number;
  /** Weighted mean net APR across the picks. */
  yourNet: number;
  /** Mean net APR across every operator with history in the range. */
  fieldNet: number;
  yourCommission: number;
  fieldCommission: number;
  /** `yourNet - fieldNet`. Positive means the picks beat the field. */
  difference: number;
  /** The part of `difference` explained by charging less (or more). */
  fromCommission: number;
  /** The part explained by producing more (or fewer) blocks. */
  fromProduction: number;
  /**
   * What the two terms do not account for.
   *
   * The split is written in terms of each group's *average* gross return and
   * *average* commission, and the average of a product is not the product of
   * the averages. The gap is the covariance between the two within each group:
   * it would matter if this network's high-commission operators were also its
   * best producers, and it does not, because commission spans 8-10% while
   * production spans about 1%. Reported rather than folded into one of the
   * named terms, so a reader is never told a number is "from commission" when
   * it is an artefact of the arithmetic.
   *
   * `fromCommission + fromProduction + unexplained === difference`, exactly.
   */
  unexplained: number;
}

/** Mean of the defined values, or null when there are none. */
function mean(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

interface OperatorMeans {
  gross: number;
  net: number;
  commission: number;
  eras: number;
}

function summarise(
  operator: OperatorSeries,
  network: ChoiceInput['network'],
  erasPerYear: number,
): OperatorMeans | null {
  const { gross, net } = deriveOperatorApr(operator, network, erasPerYear);
  const g = mean(gross);
  const n = mean(net);
  const c = mean(operator.commission);
  if (g == null || n == null || c == null) return null;
  return { gross: g, net: n, commission: c, eras: net.filter((v) => v != null).length };
}

export function compareChoice({
  eras,
  network,
  operators,
  picks,
  erasPerYear,
  minCoverage = DEFAULT_MIN_COVERAGE,
}: ChoiceInput): ChoiceComparison | null {
  if (eras.length === 0 || picks.length === 0) return null;

  const required = eras.length * minCoverage;

  const field: OperatorMeans[] = [];
  for (const operator of Object.values(operators)) {
    const summary = summarise(operator, network, erasPerYear);
    if (summary != null && summary.eras >= required) field.push(summary);
  }
  if (field.length === 0) return null;

  const fieldGross = field.reduce((a, b) => a + b.gross, 0) / field.length;
  const fieldNet = field.reduce((a, b) => a + b.net, 0) / field.length;
  const fieldCommission = field.reduce((a, b) => a + b.commission, 0) / field.length;

  const mine: { summary: OperatorMeans; weight: number }[] = [];
  for (const pick of picks) {
    const columns = operators[pick.address];
    if (!columns) continue;
    const summary = summarise(columns, network, erasPerYear);
    // The same floor on the picks. An operator nominated last week has no
    // measurable record over a ninety-era window, and averaging one in would
    // report its three eras of luck as this reader's operator choice.
    if (summary != null && summary.eras >= required) mine.push({ summary, weight: pick.weight });
  }
  if (mine.length === 0) return null;

  // Weight by assigned stake where there is any. A nominator commonly has
  // sixteen nominations and stake behind one of them, so an unweighted average
  // would describe a portfolio they do not hold. With nothing assigned — the
  // era after re-nominating, say — every pick counts once, which is the only
  // thing left to mean.
  const totalWeight = mine.reduce((a, b) => a + b.weight, 0);
  const weightOf = (entry: { weight: number }) =>
    totalWeight > 0 ? entry.weight / totalWeight : 1 / mine.length;

  const yourNet = mine.reduce((a, b) => a + b.summary.net * weightOf(b), 0);
  const yourGross = mine.reduce((a, b) => a + b.summary.gross * weightOf(b), 0);
  const yourCommission = mine.reduce((a, b) => a + b.summary.commission * weightOf(b), 0);

  const fromProduction = (yourGross - fieldGross) * (1 - yourCommission);
  const fromCommission = -fieldGross * (yourCommission - fieldCommission);
  const difference = yourNet - fieldNet;

  return {
    eras: eras.length,
    covered: mine.length,
    yourNet,
    fieldNet,
    yourCommission,
    fieldCommission,
    difference,
    fromCommission,
    fromProduction,
    unexplained: difference - fromCommission - fromProduction,
  };
}
