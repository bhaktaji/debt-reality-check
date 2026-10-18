import { describe, it, expect } from 'vitest';
import { simulatePayoff, payoffOrder } from '../../core/payoff.js';

const CARD = { name: 'card', balance: 65000, minPayment: 3500, apr: 42 };
const LOAN = { name: 'loan', balance: 120000, minPayment: 4500, apr: 16 };
const BNPL = { name: 'bnpl', balance: 15000, minPayment: 2000, apr: 30 };

describe('payoff ordering', () => {
  it('avalanche is highest APR first, tie-broken by lower balance', () => {
    const order = payoffOrder([{ name: 'a', balance: 100, minPayment: 1, apr: 20 }, { name: 'b', balance: 50, minPayment: 1, apr: 20 }], 'avalanche');
    expect(order.map((d) => d.name)).toEqual(['b', 'a']);
  });

  it('snowball is lowest balance first, tie-broken by higher APR', () => {
    const order = payoffOrder([{ name: 'big', balance: 500, minPayment: 1, apr: 40 }, { name: 'small', balance: 100, minPayment: 1, apr: 10 }], 'snowball');
    expect(order.map((d) => d.name)).toEqual(['small', 'big']);
  });

  it('reads either `balance` or the simulation book\'s `bal`', () => {
    const asBook = [{ name: 'x', bal: 10, apr: 5 }, { name: 'y', bal: 90, apr: 5 }];
    expect(payoffOrder(asBook, 'snowball').map((d) => d.name)).toEqual(['x', 'y']);
  });
});

describe('roll-over of freed minimums (F-06)', () => {
  it('keeps the budget fixed, so a cleared minimum rolls into the next target', () => {
    const r = simulatePayoff([BNPL, CARD], 10000, 'avalanche', { recordSchedule: true });
    expect(r.feasible).toBe(true);
    // The budget is fully used every month, which is only possible if freed minimums stay in.
    expect(r.maxBudgetUsed).toBeCloseTo(10000, 0);
    expect(r.schedule.every((m) => m.paid <= 10000 + 1)).toBe(true);
  });

  it('clears every debt exactly once and reports the order', () => {
    const r = simulatePayoff([CARD, LOAN, BNPL], 20000, 'avalanche');
    expect(r.feasible).toBe(true);
    expect(r.payoffOrder).toHaveLength(3);
    expect(new Set(r.payoffOrder).size).toBe(3);
  });
});

describe('the review\'s tested payoff case (Part II B.2)', () => {
  // Card 65k at 42%, loan 120k at 16%, BNPL 15k at 30%; income 60,000, core 40,000
  // => a fixed budget of 20,000/month.
  const debts = [CARD, LOAN, BNPL];

  it('finishes in 12 months', () => {
    expect(simulatePayoff(debts, 20000, 'avalanche').months).toBe(12);
    expect(simulatePayoff(debts, 20000, 'snowball').months).toBe(12);
  });

  it('reproduces the corrected rupee figures (not the v1 5x-overstated gap)', () => {
    const av = simulatePayoff(debts, 20000, 'avalanche');
    const sn = simulatePayoff(debts, 20000, 'snowball');
    expect(av.totalInterest).toBe(22147);
    expect(sn.totalInterest).toBe(22690);
    expect(sn.totalInterest - av.totalInterest).toBe(543);
    // The v1 engine reported a gap of about 2,660. Ours must be far smaller.
    expect(sn.totalInterest - av.totalInterest).toBeLessThan(1000);
  });

  it('avalanche is never more expensive than snowball', () => {
    const av = simulatePayoff(debts, 20000, 'avalanche');
    const sn = simulatePayoff(debts, 20000, 'snowball');
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest);
  });
});

describe('negative-amortisation guard (F-06)', () => {
  // Rs 1,00,000 at 48% with a Rs 3,000 minimum; income 23,500 and core 20,000
  // => a budget of 3,500 against 4,000 of monthly interest.
  const debts = [{ name: 'card', balance: 100000, minPayment: 3000, apr: 48 }];

  it('reports BUDGET_BELOW_INTEREST instead of simulating to the horizon', () => {
    const r = simulatePayoff(debts, 3500, 'avalanche');
    expect(r.feasible).toBe(false);
    expect(r.reason).toBe('BUDGET_BELOW_INTEREST');
    expect(r.monthlyInterest).toBe(4000);
    expect(r.shortfall).toBe(500);
    expect(r.totalInterest).toBe(0);
  });

  it('never returns an absurd multi-decade interest total', () => {
    const r = simulatePayoff(debts, 3500, 'avalanche');
    expect(r.months).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/360\+|Perpetual/);
  });

  it('becomes feasible as soon as the budget exceeds the interest', () => {
    const r = simulatePayoff(debts, 4100, 'avalanche');
    expect(r.feasible).toBe(true);
    expect(r.totalInterest).toBeGreaterThan(0);
  });

  it('treats a budget exactly equal to the interest as infeasible', () => {
    expect(simulatePayoff(debts, 4000, 'avalanche').feasible).toBe(false);
  });
});

describe('payoff invariants', () => {
  it('never reports negative interest', () => {
    for (const budget of [5000, 10000, 20000, 50000]) {
      const r = simulatePayoff([CARD, LOAN, BNPL], budget, 'avalanche');
      if (r.feasible) expect(r.totalInterest).toBeGreaterThanOrEqual(0);
    }
  });

  it('never spends more than the monthly budget', () => {
    const r = simulatePayoff([CARD, LOAN, BNPL], 20000, 'snowball', { recordSchedule: true });
    expect(r.maxBudgetUsed).toBeLessThanOrEqual(20001);
    expect(r.schedule.every((m) => m.paid <= 20001)).toBe(true);
  });

  it('returns a clean zero-month result when there is no debt', () => {
    const r = simulatePayoff([], 10000, 'avalanche');
    expect(r).toMatchObject({ feasible: true, months: 0, totalInterest: 0 });
  });

  it('ignores zero-balance lines', () => {
    const r = simulatePayoff([{ name: 'closed', balance: 0, minPayment: 0, apr: 40 }], 10000, 'avalanche');
    expect(r.months).toBe(0);
  });

  it('is deterministic', () => {
    const a = simulatePayoff([CARD, LOAN, BNPL], 20000, 'avalanche');
    const b = simulatePayoff([CARD, LOAN, BNPL], 20000, 'avalanche');
    expect(a).toEqual(b);
  });
});
