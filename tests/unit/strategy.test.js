import { describe, it, expect } from 'vitest';
import { recommendStrategy, compareStrategies } from '../../core/strategy.js';
import { simulatePayoff } from '../../core/payoff.js';

const av = (interest, months = 12) => ({ feasible: true, strategy: 'avalanche', months, totalInterest: interest });
const sn = (interest, months = 12) => ({ feasible: true, strategy: 'snowball', months, totalInterest: interest });

describe('strategy selection (C.6)', () => {
  it('allows snowball in tier 1-2 when the extra interest is small', () => {
    // 500 extra on 200,000 of debt is 0.25%, inside the 1% tolerance.
    const r = recommendStrategy(2, av(22000), sn(22500), 200000);
    expect(r.pick).toBe('snowball');
    expect(r.why).toMatch(/momentum/i);
  });

  it('refuses snowball when the extra interest is material', () => {
    // 8,000 extra on 200,000 is 4%, outside the 1% tolerance.
    const r = recommendStrategy(2, av(22000), sn(30000), 200000);
    expect(r.pick).toBe('avalanche');
    expect(r.delta).toBe(8000);
  });

  it('favours avalanche in tier 3 and 4 even when snowball is cheap', () => {
    expect(recommendStrategy(3, av(22000), sn(22500), 200000).pick).toBe('avalanche');
    expect(recommendStrategy(4, av(22000), sn(22500), 200000).pick).toBe('avalanche');
  });

  it('always reports the rupee cost of the choice', () => {
    const r = recommendStrategy(1, av(1000), sn(1100), 100000);
    expect(r.delta).toBe(100);
    expect(r.threshold).toBeCloseTo(1000, 6);
  });

  it('returns a restructuring message when the plan is infeasible', () => {
    const broken = { feasible: false, reason: 'BUDGET_BELOW_INTEREST', monthlyInterest: 4000, shortfall: 500, monthlyBudget: 3500 };
    const r = recommendStrategy(4, broken, sn(0), 100000);
    expect(r.pick).toBe('avalanche');
    expect(r.feasible).toBe(false);
    expect(r.reason).toBe('BUDGET_BELOW_INTEREST');
    expect(r.why).toMatch(/restructuring/i);
  });

  it('compareStrategies exposes the difference and the cheaper option', () => {
    const c = compareStrategies(2, av(22147), sn(22690), 200000);
    expect(c.difference).toBe(543);
    expect(c.cheaper).toBe('avalanche');
    expect(c.differenceLabel).toContain('543');
  });
});

describe('strategy selection agrees with the simulator', () => {
  it('picks the option the simulator says is cheaper, for a tier 3 profile', () => {
    const debts = [
      { name: 'card', balance: 65000, minPayment: 3500, apr: 42 },
      { name: 'loan', balance: 120000, minPayment: 4500, apr: 16 },
      { name: 'bnpl', balance: 15000, minPayment: 2000, apr: 30 },
    ];
    const a = simulatePayoff(debts, 20000, 'avalanche');
    const s = simulatePayoff(debts, 20000, 'snowball');
    const r = recommendStrategy(3, a, s, 200000);
    expect(r.pick).toBe('avalanche');
    expect(a.totalInterest).toBeLessThanOrEqual(s.totalInterest);
  });
});
