import { describe, it, expect } from 'vitest';
import { runDiagnosticV2 } from '../../core/engine_v2.js';
import { simulatePayoff } from '../../core/payoff.js';

/**
 * Property tests: invariants that must hold over random inputs, not just the fixtures.
 * The generator is seeded so a failure is reproducible.
 */

/** Deterministic PRNG (mulberry32) - no reliance on Math.random. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProfile(rand) {
  const income = 10000 + Math.floor(rand() * 300000);
  const debtCount = Math.floor(rand() * 4);
  const debts = [];
  for (let i = 0; i < debtCount; i++) {
    const balance = Math.floor(rand() * 500000);
    debts.push({
      name: `d${i}`,
      type: ['installment', 'revolving', 'bnpl', 'loanapp'][Math.floor(rand() * 4)],
      secured: rand() < 0.3,
      balance,
      minPayment: Math.floor(rand() * Math.max(1, balance * 0.06)),
      apr: Math.floor(rand() * 60),
      creditLimit: rand() < 0.5 ? Math.floor(balance * (1 + rand() * 2)) : null,
    });
  }
  return {
    netIncome: income,
    incomeHistory: rand() < 0.4 ? [Math.floor(income * (0.5 + rand() * 0.5))] : [],
    rent: Math.floor(rand() * income * 0.4),
    coreExpenses: Math.floor(rand() * income * 0.7),
    liquidReserves: Math.floor(rand() * income * 12),
    earners: 1 + Math.floor(rand() * 3),
    dependents: Math.floor(rand() * 4),
    familyHelp: rand() < 0.5,
    debts,
  };
}

const SEEDS = [1, 7, 42, 99, 1234, 20261004, 555, 8080];

/** True when a minimum payment does not cover the monthly interest on that line. */
function isNegativeAmortising(d) {
  if (!d || !(Number(d.balance) > 0) || !(Number(d.apr) > 0)) return false;
  return Number(d.minPayment) <= (Number(d.balance) * Number(d.apr)) / 1200;
}

describe('monotonicity', () => {
  it('raising income never worsens the tier', () => {
    for (const seed of SEEDS) {
      const rand = rng(seed);
      for (let i = 0; i < 120; i++) {
        const p = randomProfile(rand);
        const before = runDiagnosticV2(p);
        const after = runDiagnosticV2({ ...p, netIncome: p.netIncome * 1.35 });
        expect(after.tier, `seed ${seed} iteration ${i}`).toBeLessThanOrEqual(before.tier);
      }
    }
  });

  it('raising any mandatory payment never improves the tier', () => {
    // Documented exception: if the increase lifts a minimum from at-or-below its monthly
    // interest to above it, the negative-amortisation override is *removed*, and the tier
    // may legitimately improve. That narrow case is asserted separately below.
    for (const seed of SEEDS) {
      const rand = rng(seed);
      for (let i = 0; i < 120; i++) {
        const p = randomProfile(rand);
        if (!p.debts.length) continue;
        const before = runDiagnosticV2(p);
        const bumped = { ...p, debts: p.debts.map((d, j) => (j === 0 ? { ...d, minPayment: d.minPayment + 2500 } : d)) };
        const after = runDiagnosticV2(bumped);

        const negAmBefore = isNegativeAmortising(p.debts[0]);
        const negAmAfter = isNegativeAmortising(bumped.debts[0]);
        if (negAmBefore && !negAmAfter) continue; // override removed, see the next test

        expect(after.tier, `seed ${seed} iteration ${i}`).toBeGreaterThanOrEqual(before.tier);
      }
    }
  });

  it('the negative-amortisation exception is the ONLY way a higher EMI can help', () => {
    // Paying 5,000 on a card charging 6,000 of monthly interest flags the balance as
    // growing (tier 3). Paying 7,000 clears that flag, and the profile is genuinely
    // healthier - so the tier improves. This is the spec's override behaving as designed,
    // not a monotonicity bug in the rest of the engine.
    const base = {
      netIncome: 100000, rent: 0, coreExpenses: 5000, liquidReserves: 900000,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 200000, minPayment: 5000, apr: 36, creditLimit: 400000 }],
    };
    const growing = runDiagnosticV2(base);
    const covered = runDiagnosticV2({ ...base, debts: [{ ...base.debts[0], minPayment: 7000 }] });

    expect(isNegativeAmortising(base.debts[0])).toBe(true);
    expect(growing.tier).toBe(3);
    expect(covered.tier).toBe(1);
    expect(covered.tier).toBeLessThan(growing.tier);

    // The flow metrics themselves still move the wrong way, as they must.
    expect(covered.metrics.foir).toBeGreaterThan(growing.metrics.foir);
    expect(covered.metrics.dcf).toBeLessThan(growing.metrics.dcf);
  });

  it('raising rent never improves the tier', () => {
    for (const seed of SEEDS) {
      const rand = rng(seed);
      for (let i = 0; i < 80; i++) {
        const p = randomProfile(rand);
        const before = runDiagnosticV2(p);
        const after = runDiagnosticV2({ ...p, rent: p.rent + 3000 });
        expect(after.tier, `seed ${seed} iteration ${i}`).toBeGreaterThanOrEqual(before.tier);
      }
    }
  });
});

describe('scale invariance', () => {
  it('scaling every rupee amount by k preserves the tier and the ratios', () => {
    for (const seed of SEEDS) {
      const rand = rng(seed);
      for (let i = 0; i < 100; i++) {
        const p = randomProfile(rand);
        const before = runDiagnosticV2(p);
        const k = [2, 5, 10, 0.5][i % 4];
        const scaled = {
          ...p,
          netIncome: p.netIncome * k,
          incomeHistory: p.incomeHistory.map((n) => n * k),
          rent: p.rent * k,
          coreExpenses: p.coreExpenses * k,
          liquidReserves: p.liquidReserves * k,
          debts: p.debts.map((d) => ({
            ...d,
            balance: d.balance * k,
            minPayment: d.minPayment * k,
            creditLimit: d.creditLimit === null ? null : d.creditLimit * k,
          })),
        };
        const after = runDiagnosticV2(scaled);
        expect(after.tier, `seed ${seed} k=${k}`).toBe(before.tier);
        expect(after.metrics.foir, `seed ${seed} k=${k}`).toBeCloseTo(before.metrics.foir, 6);
        expect(after.metrics.dcfPct, `seed ${seed} k=${k}`).toBeCloseTo(before.metrics.dcfPct, 6);
      }
    }
  });
});

describe('purity and determinism', () => {
  it('the same input always yields the same verdict', () => {
    const rand = rng(2024);
    for (let i = 0; i < 50; i++) {
      const p = randomProfile(rand);
      expect(runDiagnosticV2(p).tier).toBe(runDiagnosticV2(p).tier);
    }
  });

  it('never mutates the caller\'s input', () => {
    const rand = rng(31);
    for (let i = 0; i < 50; i++) {
      const p = randomProfile(rand);
      const copy = JSON.parse(JSON.stringify(p));
      runDiagnosticV2(p);
      expect(p).toEqual(copy);
    }
  });

  it('always returns a tier in 1..4', () => {
    const rand = rng(77);
    for (let i = 0; i < 200; i++) {
      const d = runDiagnosticV2(randomProfile(rand));
      expect(d.tier).toBeGreaterThanOrEqual(1);
      expect(d.tier).toBeLessThanOrEqual(4);
      expect(d.flowTier).toBeLessThanOrEqual(d.tier);
      // Three documented mechanisms can push the final tier above the flow tier:
      // the runway penalty (+1, capped), the negative-amortisation floor (to 3), and
      // dependency escalation (+1, capped at 4). Worst case is +3.
      expect(d.tier - d.flowTier).toBeLessThanOrEqual(3);
    }
  });

  it('never reports a tier better than the flow tier', () => {
    const rand = rng(4242);
    for (let i = 0; i < 300; i++) {
      const d = runDiagnosticV2(randomProfile(rand));
      // A cash buffer can never rescue a structural deficit.
      expect(d.tier).toBeGreaterThanOrEqual(Math.max(d.tiers.foir, d.tiers.dcf));
    }
  });

  it('never fabricates a credit utilisation', () => {
    const rand = rng(303);
    for (let i = 0; i < 150; i++) {
      const p = randomProfile(rand);
      const d = runDiagnosticV2(p);
      const revolving = p.debts.filter((x) => x.type === 'revolving' && (x.balance > 0 || x.minPayment > 0));
      if (revolving.length && revolving.every((x) => Number(x.creditLimit) > 0)) {
        expect(d.metrics.cur).not.toBeNull();
      } else {
        expect(d.metrics.cur).toBeNull();
      }
    }
  });
});

describe('payoff invariants over random debt sets', () => {
  it('interest is never negative, the budget is never exceeded, infeasibility is detected', () => {
    const rand = rng(5150);
    for (let i = 0; i < 200; i++) {
      const debtCount = 1 + Math.floor(rand() * 4);
      const debts = [];
      for (let j = 0; j < debtCount; j++) {
        debts.push({
          name: `d${j}`,
          balance: 1000 + Math.floor(rand() * 400000),
          minPayment: Math.floor(rand() * 20000),
          apr: Math.floor(rand() * 60),
        });
      }
      const budget = 1000 + Math.floor(rand() * 60000);
      for (const strategy of ['avalanche', 'snowball']) {
        const r = simulatePayoff(debts, budget, strategy, { recordSchedule: true });
        if (r.feasible) {
          expect(r.totalInterest).toBeGreaterThanOrEqual(0);
          expect(r.maxBudgetUsed).toBeLessThanOrEqual(budget + 1);
          expect(r.schedule.every((m) => m.paid <= budget + 1)).toBe(true);
        } else {
          expect(['BUDGET_BELOW_INTEREST', 'EXCEEDS_HORIZON']).toContain(r.reason);
          // An infeasible plan must never claim a completed timeline.
          expect(r.payoffOrder).toEqual([]);
        }
      }
    }
  });

  it('an infeasible budget is always detected when interest exceeds it', () => {
    const rand = rng(616);
    for (let i = 0; i < 100; i++) {
      const balance = 50000 + Math.floor(rand() * 200000);
      const apr = 24 + Math.floor(rand() * 36);
      const interest = (balance * apr) / 1200;
      const budget = Math.max(1, Math.floor(interest * 0.9));
      const r = simulatePayoff([{ name: 'x', balance, minPayment: Math.floor(budget / 2), apr }], budget, 'avalanche');
      expect(r.feasible).toBe(false);
      expect(r.reason).toBe('BUDGET_BELOW_INTEREST');
    }
  });
});
