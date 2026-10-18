/**
 * core/engine_v2.js
 * Deterministic solvency engine, Algorithm v2 (Part II section C).
 *
 * PURE: no I/O, no clock, no randomness, no network. Every surface (web, bot, CLI,
 * tests) imports THIS module, so they can never disagree (F-03).
 *
 * Money is in rupees inside the core. Storage uses integer paise (see store/).
 * Rates are nominal annual % on a reducing balance unless a quote is normalised first.
 */

import { POLICY, TIER_LABELS, TIER_STATUS, DIRECTIVES, CAREER_RISK, tierUp, tierDown, tierLabel } from './policy.js';
import { simulatePayoff } from './payoff.js';
import { recommendStrategy, compareStrategies } from './strategy.js';
import { checkPlausibility } from './plausibility.js';
import { inr, pct, months as fmtMonths } from './formatting.js';

export { POLICY, TIER_LABELS, TIER_STATUS, DIRECTIVES, CAREER_RISK, tierUp, tierDown, tierLabel };

/* ------------------------------------------------------------------ *
 * 1. Rate normalisation (C.3): what a loan REALLY costs
 * ------------------------------------------------------------------ */

/**
 * Nominal APR (%/yr, reducing balance) implied by the cash actually received versus
 * the EMIs actually paid. `fee` is deducted from the cash received up front.
 */
export function trueApr({ principal, fee = 0, emi, months }) {
  const net = principal - fee;
  if (net <= 0 || emi * months <= net) return 0;
  const pv = (r) => (r === 0 ? emi * months : (emi * (1 - Math.pow(1 + r, -months))) / r);
  let lo = 0;
  let hi = 1;
  while (pv(hi) > net && hi < 1e4) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > net) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 12 * 100;
}

/** EMI for a flat-rate loan: interest is charged on the full principal for the whole term. */
export function flatToEmi({ principal, flatRatePctPerYear, months }) {
  return (principal + principal * (flatRatePctPerYear / 100) * (months / 12)) / months;
}

/** Daily percentage -> nominal annual APR, e.g. 0.1%/day -> 36.5%. */
export function dailyRateToApr(dailyPct) {
  return dailyPct * 365;
}

/**
 * Normalise a debt's rate to a comparable reducing-balance APR.
 * Never invents a rate: returns null when neither `apr` nor a `quote` is present.
 *
 * @returns {{apr:number|null, source:'reducing'|'flat'|'daily'|null, emi?:number, note?:string}}
 */
export function normaliseRate(debt = {}) {
  if (debt.apr !== null && debt.apr !== undefined && debt.apr !== '') {
    const apr = Number(debt.apr);
    if (Number.isFinite(apr)) return { apr, source: 'reducing' };
  }
  const quote = debt.quote;
  if (!quote || typeof quote !== 'object') return { apr: null, source: null };

  if (quote.basis === 'daily') {
    const rate = Number(quote.rate);
    if (!Number.isFinite(rate)) return { apr: null, source: null };
    return {
      apr: dailyRateToApr(rate),
      source: 'daily',
      note: `${rate}% per day is a nominal ${dailyRateToApr(rate).toFixed(1)}% APR.`,
    };
  }

  if (quote.basis === 'flat') {
    const flat = Number(quote.rate);
    const term = Number(quote.months);
    const principal = Number(quote.principal ?? debt.balance);
    const fee = Number(quote.fee || 0);
    if (!Number.isFinite(flat) || !Number.isFinite(term) || term <= 0 || !Number.isFinite(principal)) {
      return { apr: null, source: null };
    }
    const emi = flatToEmi({ principal, flatRatePctPerYear: flat, months: term });
    const apr = trueApr({ principal, fee, emi, months: term });
    return {
      apr,
      source: 'flat',
      emi,
      note: `${flat}% flat over ${term} months on ${inr(principal)}${fee ? ` with a ${inr(fee)} up-front fee` : ''} is a true APR of ${apr.toFixed(1)}%.`,
    };
  }

  return { apr: null, source: null };
}

/* ------------------------------------------------------------------ *
 * 2. Distance to the next better tier (C.5)
 * ------------------------------------------------------------------ */

/**
 * The smallest single change that would move the verdict up one tier.
 * Reducing mandatory payments improves FOIR, DCF and runway at once, so the FOIR/DCF
 * options are labelled as such.
 */
export function distanceToNextTier(tier, metrics) {
  if (tier <= 1) return { applicable: false, options: [], message: 'Already in the best tier.' };

  const target = tier - 1;
  const { incomeEff, foir, dcf, dcfPct, er, outflow, liquidReserves, mandatory } = metrics;
  const options = [];

  const foirCut = POLICY.foirCuts[target - 1];
  if (foirCut !== undefined && foir >= foirCut) {
    const reduction = mandatory - (foirCut / 100) * incomeEff;
    if (reduction > 0) {
      options.push({
        metric: 'FOIR',
        label: `Reduce mandatory payments by ${inr(reduction)}/month`,
        amount: reduction,
        from: foir,
        to: foirCut,
        detail: `FOIR must fall below ${foirCut}% of income (currently ${pct(foir)}).`,
      });
    }
  }

  const dcfCut = target <= 3 ? POLICY.dcfPctCuts[target - 1] ?? 0 : 0;
  if (dcfPct < dcfCut) {
    const increase = (dcfCut / 100) * incomeEff - dcf;
    if (increase > 0) {
      options.push({
        metric: 'DCF',
        label: `Raise monthly surplus (DCF) by ${inr(increase)}`,
        amount: increase,
        from: dcfPct,
        to: dcfCut,
        detail: `DCF must reach ${dcfCut}% of income (currently ${pct(dcfPct)}).`,
      });
    }
  }

  const erCut = POLICY.erCuts[target - 1];
  if (erCut !== undefined && er < erCut) {
    const increase = erCut * outflow - liquidReserves;
    if (increase > 0) {
      options.push({
        metric: 'Runway',
        label: `Add ${inr(increase)} to liquid reserves`,
        amount: increase,
        from: er,
        to: erCut,
        detail: `Runway must reach ${erCut} months of outflow (currently ${fmtMonths(er)}).`,
      });
    }
  }

  options.sort((a, b) => a.amount - b.amount);
  return {
    applicable: true,
    targetTier: target,
    targetLabel: TIER_LABELS[target],
    options,
    best: options[0] || null,
    message: options.length
      ? `Smallest single change to reach ${TIER_LABELS[target]}: ${options[0].label}.`
      : `Reaching ${TIER_LABELS[target]} needs a combination of changes.`,
  };
}

/* ------------------------------------------------------------------ *
 * 3. Diagnostic
 * ------------------------------------------------------------------ */

const DEFAULT_DEBT = Object.freeze({ type: null, secured: null, balance: 0, minPayment: 0, apr: null, creditLimit: null });

/**
 * Run Algorithm v2.
 *
 * @param {object} input
 * @param {number} input.netIncome        monthly take-home
 * @param {number[]} [input.incomeHistory] last 3-6 months (lowest recent month is used)
 * @param {number} input.coreExpenses     survival costs, excluding rent and EMIs
 * @param {number} [input.rent]           contractual housing cost
 * @param {number} [input.liquidReserves] cash/bank available within days
 * @param {number} [input.earners]
 * @param {number} [input.dependents]
 * @param {boolean} [input.familyHelp]    contingent support - NEVER improves the tier
 * @param {Array}  [input.debts]
 * @param {object} [input.profile]        raw profile, only used for plausibility checks
 * @param {boolean}[input.recordSchedule]
 */
export function runDiagnosticV2(input = {}) {
  const netIncome = Number(input.netIncome);
  const history = (Array.isArray(input.incomeHistory) ? input.incomeHistory : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const coreExpenses = Number(input.coreExpenses) || 0;
  const rent = Number(input.rent) || 0;
  const liquidReserves = Number(input.liquidReserves) || 0;
  const earners = Number.isFinite(Number(input.earners)) ? Number(input.earners) : 1;
  const dependents = Number(input.dependents) || 0;
  const familyHelp = Boolean(input.familyHelp);
  const debts = Array.isArray(input.debts) ? input.debts : [];

  if (!Number.isFinite(netIncome) || netIncome <= 0) {
    return {
      ok: false,
      error: 'INVALID_INCOME',
      message: 'A positive monthly income is required before a diagnostic can be produced.',
      warnings: [{ code: 'NO_INCOME', field: 'netIncome', message: 'Enter monthly take-home income.' }],
    };
  }

  // Effective income = weakest recent month, optionally stressed (C.4).
  const incomeEff = Math.min(netIncome, ...history) * (1 - POLICY.incomeStress);

  const live = debts
    .map((d, i) => ({ ...DEFAULT_DEBT, ...d, id: d.id ?? i, name: d.name || `Debt ${i + 1}` }))
    .filter((d) => Number(d.balance) > 0 || Number(d.minPayment) > 0)
    .map((d) => ({ ...d, balance: Number(d.balance) || 0, minPayment: Number(d.minPayment) || 0, apr: Number(d.apr) || 0, secured: d.secured === true }));

  const totalEmi = live.reduce((s, d) => s + d.minPayment, 0);
  const totalBalance = live.reduce((s, d) => s + d.balance, 0);
  const mandatory = totalEmi + rent;
  const outflow = coreExpenses + mandatory;

  const foir = (mandatory / incomeEff) * 100;
  const dcf = incomeEff - outflow;
  const dcfPct = (dcf / incomeEff) * 100;
  const er = outflow > 0 ? liquidReserves / outflow : Infinity;

  const interestBurn = live.reduce((s, d) => s + (d.balance * d.apr) / 1200, 0);
  const dtiMonths = totalBalance / incomeEff;

  const negAm = live
    .filter((d) => d.balance > 0 && d.minPayment <= (d.balance * d.apr) / 1200)
    .map((d) => d.name);

  const unsecuredLines = live.filter((d) => !d.secured && d.balance > 0).length;
  const securedLines = live.filter((d) => d.secured && d.balance > 0).length;

  // A missing rate is never inferred from a type or an APR band; it stays unknown.
  const unknownRateLines = debts
    .filter((d) => (Number(d.balance) > 0 || Number(d.minPayment) > 0) && (d.apr == null || d.apr === '') && !d.quote)
    .map((d, i) => d.name || `Debt ${i + 1}`);

  const revolving = live.filter((d) => d.type === 'revolving');
  const cur = revolving.length && revolving.every((d) => Number(d.creditLimit) > 0)
    ? (revolving.reduce((s, d) => s + d.balance, 0) / revolving.reduce((s, d) => s + Number(d.creditLimit), 0)) * 100
    : null;

  const monthsToDefault = dcf < 0 ? liquidReserves / Math.abs(dcf) : Infinity;

  /* ---- per-metric tiers -------------------------------------------------- */
  const tFoir = tierUp(foir, POLICY.foirCuts);
  const tDcf = dcf < 0
    ? (monthsToDefault < POLICY.deficitHorizonMonths ? 4 : 3)
    : tierDown(dcfPct, POLICY.dcfPctCuts);
  const tEr = tierDown(er, POLICY.erCuts);

  /* ---- combination: flow decides, a thin buffer worsens by at most one --- */
  let tier = Math.max(tFoir, tDcf);
  const flowTier = tier;
  tier = Math.max(flowTier, Math.min(tEr, flowTier + POLICY.runwayMaxPenalty));

  const notes = [];
  if (tier > flowTier) {
    notes.push('Runway-limited: cash flow alone would rate better, but the cash buffer is thin.');
  }

  /* ---- overrides --------------------------------------------------------- */
  if (negAm.length) {
    notes.push(`Balance growing on: ${negAm.join(', ')} (minimum is at or below the monthly interest).`);
    if (tier < POLICY.negativeAmortisationMinTier) tier = POLICY.negativeAmortisationMinTier;
  }

  const dependencyLoad = earners + dependents > 0 ? dependents / (earners + dependents) : 0;
  let dependencyEscalated = false;
  if (dependencyLoad >= POLICY.dependencyLoadThreshold && er < POLICY.dependencyRunwayThreshold && tier < 4) {
    tier += 1;
    dependencyEscalated = true;
    notes.push('Dependency escalation: half or more of the household is non-earning and runway is under 3 months.');
  }

  if (familyHelp) {
    notes.push('External family help is shown as a contingent buffer only. It cannot be verified, so it never improves the tier.');
  }

  /* ---- drivers and explanation ------------------------------------------ */
  const tiered = [['FOIR', tFoir], ['DCF', tDcf], ['Runway', tEr]];
  const drivers = tiered.filter(([, t]) => t === tier).map(([n]) => n);

  const explanation = [];
  explanation.push(`FOIR is ${pct(foir)} of effective income -> tier ${tFoir} band.`);
  explanation.push(
    dcf < 0
      ? `DCF is ${pct(dcfPct)} of income (a deficit); reserves cover ${fmtMonths(monthsToDefault)} -> tier ${tDcf}.`
      : `DCF is ${pct(dcfPct)} of income -> tier ${tDcf} band.`,
  );
  explanation.push(`Emergency runway is ${fmtMonths(er)} of outflow -> tier ${tEr} band.`);
  explanation.push(`Flow tier = max(FOIR, DCF) = tier ${flowTier}. A thin buffer can worsen a flow tier by at most one level, and never improve it.`);
  if (tier !== flowTier && !negAm.length && !dependencyEscalated) {
    explanation.push(`Final tier ${tier}: the buffer moved it up one level from the flow tier.`);
  }
  if (negAm.length) explanation.push(`Override: at least tier ${POLICY.negativeAmortisationMinTier} because a minimum payment does not cover its monthly interest.`);
  if (dependencyEscalated) explanation.push('Override: dependency load raised the tier by one.');

  /* ---- payoff ------------------------------------------------------------ */
  const budget = totalEmi + Math.max(0, dcf);
  const avalanche = simulatePayoff(live, budget, 'avalanche', { recordSchedule: Boolean(input.recordSchedule) });
  const snowball = simulatePayoff(live, budget, 'snowball', { recordSchedule: Boolean(input.recordSchedule) });
  const strategy = recommendStrategy(tier, avalanche, snowball, totalBalance);
  const payoff = compareStrategies(tier, avalanche, snowball, totalBalance);

  /* ---- directives -------------------------------------------------------- */
  const directives = DIRECTIVES[tier];

  const careerApplies = foir >= CAREER_RISK.foirTriggerPct || er < CAREER_RISK.runwayTriggerMonths;
  const career = {
    applies: careerApplies,
    trigger: careerApplies
      ? `FOIR is ${pct(foir)} and runway is ${fmtMonths(er)}.`
      : `FOIR is ${pct(foir)} and runway is ${fmtMonths(er)}; the rule does not bite.`,
    adviseAgainst: careerApplies ? [...CAREER_RISK.adviseAgainst] : [],
    permitted: CAREER_RISK.permitted,
    note: 'This is about income variance, not about entrepreneurship as such. It is advice, not a restriction.',
  };

  /* ---- credit-stress indicators (never called "bureau-equivalent") ------- */
  const creditStress = {
    label: 'Credit-stress indicators',
    note: 'These are non-bureau proxies derived from the data you entered. They are not a credit score and are not a bureau report.',
    utilisation: cur,
    utilisationStatus: cur === null ? 'unknown (a required credit limit is missing)' : cur > 70 ? 'severe' : cur > 30 ? 'elevated' : 'normal',
    unsecuredLines,
    securedLines,
    revolvingLines: revolving.length,
    stackingFlag: unsecuredLines >= 3,
  };

  const metrics = {
    incomeEff, foir, dcf, dcfPct, er, interestBurn, dtiMonths, cur,
    unsecuredLines, securedLines, monthsToDefault, totalBalance, totalEmi,
    rent, coreExpenses, mandatory, outflow, liquidReserves, dependencyLoad,
  };

  const distance = distanceToNextTier(tier, metrics);

  // Plausibility: use the raw profile when supplied, else synthesise one.
  const profile = input.profile || {
    netIncome, incomeHistory: history, coreExpenses, rent, liquidReserves,
    earners, dependents, familyHelp, debts,
  };
  const { warnings, questions } = checkPlausibility(profile);

  const engineWarnings = [];
  if (unknownRateLines.length) {
    engineWarnings.push({
      code: 'RATE_UNKNOWN',
      field: 'debts',
      message: `No rate was given for: ${unknownRateLines.join(', ')}. Those lines are simulated at 0% interest until a rate is provided, so the true cost is higher.`,
    });
  }

  return {
    ok: true,
    tier,
    tierLabel: TIER_LABELS[tier],
    status: TIER_STATUS[tier],
    flowTier,
    tiers: { foir: tFoir, dcf: tDcf, runway: tEr },
    drivers,
    notes,
    explanation,
    metrics,
    creditStress,
    warnings: [...engineWarnings, ...warnings],
    questions,
    directives,
    career,
    distance,
    avalanche,
    snowball,
    strategy,
    payoff,
    budget,
  };
}

export default { runDiagnosticV2, trueApr, flatToEmi, dailyRateToApr, normaliseRate, distanceToNextTier };
