/**
 * core/policy.js
 * Algorithm v2 policy: thresholds, tier labels, directives and career-risk wording.
 *
 * Source of truth: "Debt Reality Checker" whitepaper & review addendum (4 Oct 2026),
 * Part II section C. Where Part II conflicts with Part I, Part II wins.
 *
 * This module is PURE: no I/O, no clock, no randomness, no network.
 */

/** Tunable policy values. Every threshold lives here so it is testable and auditable. */
export const POLICY = Object.freeze({
  /** FOIR cut-offs in % of income, ascending is worse. Half-open: a value ON a cut-off is the worse tier. */
  foirCuts: Object.freeze([40, 50, 65]),
  /** DCF cut-offs in % of income, descending is worse (used only when DCF >= 0). */
  dcfPctCuts: Object.freeze([25, 10]),
  /** Emergency-runway cut-offs in months, descending is worse. */
  erCuts: Object.freeze([6, 3, 1]),
  /** DCF < 0 and reserves last fewer than this many months -> tier 4, else tier 3. */
  deficitHorizonMonths: 6,
  /** A thin cash buffer may worsen a flow-based tier by at most this many levels. */
  runwayMaxPenalty: 1,
  /** Snowball is allowed (tier 1-2) when it costs at most this % of total debt more than avalanche. */
  snowballMaxExtraCostPct: 1,
  /** Income stress haircut applied to effective income (0 = off, 0.1-0.2 for a stress run). */
  incomeStress: 0,
  /** Dependency escalation: non-earning share at or above this ... */
  dependencyLoadThreshold: 0.5,
  /** ... and runway under this many months, raises the tier by one (capped at 4). */
  dependencyRunwayThreshold: 3,
  /** Any debt whose minimum <= its monthly interest forces at least this tier. */
  negativeAmortisationMinTier: 3,
  /** Data-quality guard: core expenses below this % of income is flagged as implausible. */
  lowCoreExpensePctOfIncome: 10,
  /** Data-quality guard: any single entered amount above this multiple of monthly income is flagged. */
  singleAmountMultipleOfIncome: 10,
  /** Data-quality guard: reserves above this many years of expenses is flagged. */
  reservesYearsOfExpenses: 5,
  /** Ask "per year or per month?" when a quoted rate exceeds this value. */
  rateClarificationThresholdPct: 100,
  /** Payoff simulator horizon (months). */
  payoffMaxMonths: 600,
  /** Rounding tolerance for a cleared balance, in rupees. */
  payoffEpsilon: 0.005,
});

/** Tier 1..4 labels. Tier 4 is deliberately NOT "insolvent" - that has a legal meaning. */
export const TIER_LABELS = Object.freeze({
  1: 'Solvent',
  2: 'Fragile',
  3: 'Critical debt trap',
  4: 'Acute cash-flow crisis',
});

/** Short, factual one-line status used in reports and bot replies. */
export const TIER_STATUS = Object.freeze({
  1: 'Cash flow and buffer are both healthy.',
  2: 'Cash flow is workable but the buffer is thin or the debt service is heavy.',
  3: 'Debt service is consuming income faster than it can be rebuilt.',
  4: 'Monthly outflow exceeds income or the buffer cannot cover the shortfall.',
});

/** Directives by tier (Part II C.8). Advisory wording only - never "prohibited". */
export const DIRECTIVES = Object.freeze({
  1: Object.freeze({
    borrowing: 'Borrowing is permitted only while FOIR stays below 40%.',
    career:
      'Career mobility is permitted. Keep at least 6 months of runway through any transition.',
    next30:
      'Build the buffer to 6 months; prepay the highest-APR debt first. For anything investment-related, consult a SEBI-registered adviser outside this tool.',
  }),
  2: Object.freeze({
    borrowing:
      'No new unsecured debt. Refinance only if the true APR falls after all fees are included.',
    career: 'Prefer fixed pay. Move only to equal or higher fixed pay.',
    next30:
      'Use Avalanche, or Snowball if the extra cost is small (see the payoff comparison). Build the buffer.',
  }),
  3: Object.freeze({
    borrowing: 'Freeze: no new credit lines and no balance-transfer churn.',
    career: 'Keep fixed income; variable-pay moves are not advised until the metrics recover.',
    next30:
      'Use Avalanche. Trim discretionary spend. If DCF stays under 10% of income, ask lenders about hardship terms.',
  }),
  4: Object.freeze({
    borrowing: 'Freeze.',
    career: 'Protect income; add fixed-pay hours if that is possible.',
    next30:
      'Contact lenders before missing a payment. Verify each lending app in the RBI digital-lending directory. Consider non-profit credit counselling. Document and report any harassment.',
  }),
});

/**
 * Career-risk rule, restated (Part II C.7): it is about income variance, not about
 * entrepreneurship as such. A move to equal or higher fixed pay stays acceptable while
 * the buffer holds up.
 */
export const CAREER_RISK = Object.freeze({
  /** The rule applies when FOIR >= 40% or runway < 6 months. */
  foirTriggerPct: 40,
  runwayTriggerMonths: 6,
  /** A pay-preserving move needs at least this much runway through the transition. */
  minimumRunwayForTransitionMonths: 3,
  adviseAgainst: Object.freeze([
    'commission-only income',
    'self-employment that replaces fixed pay',
    'unpaid gaps between roles',
    'any move that reduces fixed monthly pay',
  ]),
  permitted:
    'A move to equal or higher fixed pay is acceptable while runway stays at 3 months or more through any notice period.',
  advisoryPrefix: 'Not advised until',
});

/**
 * Count of cut-offs at or below `value` -> 1..n+1. Bigger value = worse tier.
 * Half-open bands: a value exactly on a cut-off belongs to the worse tier.
 */
export function tierUp(value, cuts) {
  let n = 0;
  for (const c of cuts) if (value >= c) n++;
  return 1 + n;
}

/**
 * Count of cut-offs strictly above `value` -> 1..n+1. Smaller value = worse tier.
 * Half-open bands: a value exactly on a cut-off belongs to the better tier.
 */
export function tierDown(value, cuts) {
  let n = 0;
  for (const c of cuts) if (value < c) n++;
  return 1 + n;
}

/** Human label for a tier. */
export function tierLabel(tier) {
  return TIER_LABELS[tier] || `Tier ${tier}`;
}

export default POLICY;
