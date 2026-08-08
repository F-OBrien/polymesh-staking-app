/**
 * Slashing: the penalty model, and what a slash costs a nominator.
 *
 * The previous app had a chart called `FineCurves` sitting in the Overview tab
 * with no explanation, which was easy to mistake for slashing *history*. It was
 * not — it plotted the two penalty **formulas** against the number of
 * simultaneous offenders, from the active operator count alone. That is a
 * genuinely useful thing to show, because both penalties are superlinear in how
 * many operators fail *together*, which is the single most counter-intuitive
 * property of Substrate slashing and the reason spreading nominations across
 * independent operators matters. It just needed saying out loud.
 *
 * So the curves are kept and the maths is lifted here verbatim, with the
 * constants named. History is a separate concern — see `lib/schemas/data.ts`
 * and `/slashing`.
 */

/**
 * Penalty for unresponsiveness (the `im-online` offence): a validator that
 * stops sending heartbeats.
 *
 *   fraction = min( 3 * (k - (n/10 + 1)) / n, 1 ) * 0.07
 *
 * where `k` is the number of validators offending in the same session and `n`
 * is the size of the active set.
 *
 * Two properties are worth reading off the formula, because both are
 * surprising:
 *
 *  - **There is a free allowance.** While `k <= n/10 + 1` the term goes
 *    negative and the penalty is zero. A single validator going offline in
 *    isolation is not slashed at all — it simply earns nothing.
 *  - **It is capped at 7%**, and reaches that cap once roughly a third of the
 *    set is unresponsive at once.
 */
export function unresponsivenessPenalty(offenders: number, validators: number): number {
  if (validators <= 0) return 0;
  const allowance = validators / 10 + 1;
  return Math.max(Math.min((3 * (offenders - allowance)) / validators, 1), 0) * 0.07;
}

/**
 * Penalty for equivocation (signing two conflicting blocks or votes — a BABE or
 * GRANDPA offence).
 *
 *   fraction = min( (3k / n)^2, 1 )
 *
 * Quadratic, with no free allowance: an isolated equivocation by one validator
 * in a set of a hundred costs 0.09% of stake, while thirty-four doing it at
 * once costs everything. That asymmetry is deliberate — an isolated
 * equivocation is almost always a misconfiguration, whereas a correlated one is
 * indistinguishable from an attack.
 */
export function equivocationPenalty(offenders: number, validators: number): number {
  if (validators <= 0) return 0;
  return Math.min(((3 * offenders) / validators) ** 2, 1);
}

export type OffenceKind = 'unresponsiveness' | 'equivocation';

export const OFFENCE_LABELS: Record<OffenceKind, string> = {
  unresponsiveness: 'Unresponsiveness',
  equivocation: 'Equivocation',
};

/**
 * Both penalty curves sampled across every possible offender count.
 *
 * `0..validators` inclusive, so the curve reaches its true endpoint rather than
 * stopping one short — the old implementation looped to `operatorCount + 1`
 * exclusive, which is the same range, written less obviously.
 */
export function penaltyCurves(validators: number): {
  offenders: number[];
  unresponsiveness: number[];
  equivocation: number[];
} {
  const offenders: number[] = [];
  const unresponsiveness: number[] = [];
  const equivocation: number[] = [];

  for (let k = 0; k <= Math.max(0, validators); k += 1) {
    offenders.push(k);
    unresponsiveness.push(unresponsivenessPenalty(k, validators));
    equivocation.push(equivocationPenalty(k, validators));
  }

  return { offenders, unresponsiveness, equivocation };
}

/**
 * The smallest number of simultaneous offenders that triggers a non-zero
 * penalty, or null if the curve never leaves zero.
 *
 * Only meaningful for unresponsiveness — equivocation has no allowance — but
 * written generally so the page can state the threshold rather than leave the
 * reader to infer it from a curve leaving the axis.
 */
export function firstPenalisedOffenderCount(
  validators: number,
  penalty: (offenders: number, validators: number) => number,
): number | null {
  for (let k = 1; k <= validators; k += 1) {
    if (penalty(k, validators) > 0) return k;
  }
  return null;
}

/**
 * What a slash of `fraction` costs a nominator holding `bonded`.
 *
 * Slashing is proportional to exposure, so a nominator loses the same
 * percentage as the operator regardless of how large the operator is. Nominators
 * consistently expect their loss to be diluted across the operator's other
 * backers; it is not.
 */
export function nominatorLoss(bonded: number, fraction: number): number {
  return bonded * Math.max(0, Math.min(1, fraction));
}
