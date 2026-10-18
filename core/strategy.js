/**
 * core/strategy.js  (v2)
 * Cost-aware strategy selector (Part II C.6).
 *
 * Avalanche stays the cost-minimising baseline. Snowball is allowed only when the
 * borrower is in tier 1 or 2 AND the extra interest is small (default <= 1% of total
 * debt), so behavioural momentum never silently costs real money. The rupee cost of the
 * choice is always reported.
 *
 * Pure. No I/O.
 */

import { POLICY } from './policy.js';
import { inr } from './formatting.js';

/**
 * @param {number} tier final tier 1..4
 * @param {object} avalanche result of simulatePayoff(..., 'avalanche')
 * @param {object} snowball  result of simulatePayoff(..., 'snowball')
 * @param {number} totalBalance total outstanding balance
 */
export function recommendStrategy(tier, avalanche, snowball, totalBalance) {
  const avFeasible = Boolean(avalanche?.feasible);
  const snFeasible = Boolean(snowball?.feasible);

  if (!avFeasible || !snFeasible) {
    const broken = !avFeasible ? avalanche : snowball;
    return {
      pick: 'avalanche',
      delta: null,
      feasible: false,
      reason: broken?.reason || 'INFEASIBLE',
      monthlyInterest: broken?.monthlyInterest ?? null,
      shortfall: broken?.shortfall ?? null,
      why: 'The plan is infeasible at the current cash flow; restructuring or a higher debt-service budget comes first.',
    };
  }

  const delta = snowball.totalInterest - avalanche.totalInterest;
  const threshold = (POLICY.snowballMaxExtraCostPct / 100) * (Number(totalBalance) || 0);
  const cheap = delta <= threshold;

  if (tier <= 2 && cheap) {
    return {
      pick: 'snowball',
      delta,
      feasible: true,
      threshold,
      why: `Quick wins cost ${inr(delta)} extra in interest, which is within the ${POLICY.snowballMaxExtraCostPct}% of total debt tolerance; momentum improves completion odds.`,
    };
  }

  const why = tier >= 3
    ? `Highest-APR-first saves ${inr(delta)} in interest. In tier ${tier} the interest cost of the behavioural option is not worth paying.`
    : `Highest-APR-first saves ${inr(delta)} in interest, which is more than the ${POLICY.snowballMaxExtraCostPct}% of total debt tolerance.`;

  return { pick: 'avalanche', delta, feasible: true, threshold, why };
}

/** Build the payoff comparison block shown by every surface. */
export function compareStrategies(tier, avalanche, snowball, totalBalance) {
  const recommendation = recommendStrategy(tier, avalanche, snowball, totalBalance);
  const delta = avalanche?.feasible && snowball?.feasible
    ? snowball.totalInterest - avalanche.totalInterest
    : null;

  return {
    avalanche,
    snowball,
    difference: delta,
    differenceLabel: delta === null ? 'n/a' : inr(delta),
    cheaper: delta === null ? null : delta >= 0 ? 'avalanche' : 'snowball',
    recommended: recommendation.pick,
    recommendation,
  };
}

export default { recommendStrategy, compareStrategies };
