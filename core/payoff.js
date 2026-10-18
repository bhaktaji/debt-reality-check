/**
 * core/payoff.js  (v2)
 * Corrected debt-payoff simulator (Part II C.6).
 *
 * The defining behaviour of both Avalanche and Snowball is that the monthly debt-service
 * budget is FIXED: minimums + positive DCF. When a debt clears, its minimum stays in the
 * budget and rolls into the next target automatically. The v1 engine dropped freed
 * minimums, which overstated timelines and the Avalanche advantage (F-06).
 *
 * Guards:
 *  - BUDGET_BELOW_INTEREST: if the budget is at or below the initial monthly interest the
 *    plan is infeasible; we report the shortfall instead of simulating 360+ months.
 *  - EXCEEDS_HORIZON: a plan that still has a balance after maxMonths is reported as
 *    infeasible rather than returning a nonsense interest total.
 *
 * Pure. No I/O, no clock, no randomness.
 */

import { POLICY } from './policy.js';

/** Priority comparator for a strategy. */
export function payoffOrder(debts, strategy) {
  const list = [...debts];
  // The simulation book carries `bal`; a plain debt carries `balance`. Read either.
  const bal = (d) => Number(d.bal ?? d.balance) || 0;
  const apr = (d) => Number(d.apr) || 0;
  if (strategy === 'avalanche') {
    // Highest APR first; tie-break on the lower balance.
    list.sort((a, b) => apr(b) - apr(a) || bal(a) - bal(b));
  } else {
    // Lowest balance first; tie-break on the higher APR.
    list.sort((a, b) => bal(a) - bal(b) || apr(b) - apr(a));
  }
  return list;
}

/**
 * Simulate a payoff plan.
 *
 * @param {Array<{name?:string, balance:number, minPayment:number, apr:number}>} debts
 * @param {number} monthlyBudget  fixed monthly amount available for debt service
 * @param {'avalanche'|'snowball'} strategy
 * @param {{maxMonths?:number, recordSchedule?:boolean}} [options]
 */
export function simulatePayoff(debts, monthlyBudget, strategy = 'avalanche', options = {}) {
  const { maxMonths = POLICY.payoffMaxMonths, recordSchedule = false } = options;
  const EPS = POLICY.payoffEpsilon;

  const book = (debts || [])
    .filter((d) => Number(d.balance) > 0)
    .map((d, i) => ({
      id: d.id ?? i,
      name: d.name ?? `Debt ${i + 1}`,
      bal: Number(d.balance),
      minPayment: Number(d.minPayment) || 0,
      apr: Number(d.apr) || 0,
      r: (Number(d.apr) || 0) / 1200,
    }));

  const base = { strategy, feasible: true, months: 0, totalInterest: 0, payoffOrder: [], maxBudgetUsed: 0 };

  if (!book.length) return { ...base, monthlyBudget: Number(monthlyBudget) || 0 };

  const budget = Number(monthlyBudget) || 0;
  const interest0 = book.reduce((s, d) => s + d.bal * d.r, 0);

  if (budget <= interest0) {
    return {
      ...base,
      feasible: false,
      reason: 'BUDGET_BELOW_INTEREST',
      monthlyBudget: budget,
      monthlyInterest: Math.round(interest0),
      shortfall: Math.round(interest0 - budget),
    };
  }

  const order = payoffOrder(book, strategy);
  const cleared = new Set();
  const clearedOrder = [];
  const schedule = [];
  let months = 0;
  let totalInterest = 0;
  let maxBudgetUsed = 0;

  while (months < maxMonths && book.some((d) => d.bal > EPS)) {
    months++;
    let pool = budget;

    // 1. accrue interest
    for (const d of book) {
      if (d.bal > 0) {
        const i = d.bal * d.r;
        d.bal += i;
        totalInterest += i;
      }
    }

    const active = () => book.filter((x) => x.bal > EPS).sort((a, b) =>
      order.findIndex((o) => o.id === a.id) - order.findIndex((o) => o.id === b.id));

    // 2. pay each minimum in priority order
    for (const d of active()) {
      if (pool <= 0) break;
      const p = Math.min(d.bal, d.minPayment, pool);
      d.bal -= p;
      pool -= p;
    }

    // 3. cascade everything left down the priority list (freed minimums included,
    //    because the budget itself never shrinks)
    for (const d of active()) {
      if (pool <= 0) break;
      const p = Math.min(d.bal, pool);
      d.bal -= p;
      pool -= p;
    }

    // record newly cleared debts
    for (const d of book) {
      if (d.bal <= EPS && !cleared.has(d.id)) {
        cleared.add(d.id);
        clearedOrder.push(d.name);
      }
    }

    const used = budget - pool;
    if (used > maxBudgetUsed) maxBudgetUsed = used;
    if (recordSchedule) {
      schedule.push({
        month: months,
        totalBalance: Math.round(book.reduce((s, d) => s + Math.max(0, d.bal), 0)),
        paid: Math.round(used),
      });
    }
  }

  const left = book.reduce((s, d) => s + Math.max(0, d.bal), 0);

  if (left > EPS) {
    return {
      ...base,
      feasible: false,
      reason: 'EXCEEDS_HORIZON',
      monthlyBudget: budget,
      endingBalance: Math.round(left),
      months: maxMonths,
      maxBudgetUsed: Math.round(maxBudgetUsed),
    };
  }

  return {
    ...base,
    feasible: true,
    months,
    totalInterest: Math.round(totalInterest),
    payoffOrder: clearedOrder,
    monthlyBudget: budget,
    maxBudgetUsed: Math.round(maxBudgetUsed),
    ...(recordSchedule ? { schedule } : {}),
  };
}

export default { simulatePayoff, payoffOrder };
