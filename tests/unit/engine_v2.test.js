import { describe, it, expect } from 'vitest';
import {
  runDiagnosticV2, trueApr, flatToEmi, dailyRateToApr, normaliseRate, distanceToNextTier,
} from '../../core/engine_v2.js';
import { CAREER_RISK, DIRECTIVES } from '../../core/policy.js';

describe('rate normalisation (C.3)', () => {
  it('reproduces the worked example: 20,000 at 24% flat over 6 months', () => {
    const emi = flatToEmi({ principal: 20000, flatRatePctPerYear: 24, months: 6 });
    expect(emi).toBeCloseTo(3733.33, 2);
    expect(trueApr({ principal: 20000, fee: 0, emi, months: 6 })).toBeCloseTo(40.0, 1);
    // A 10% up-front fee (2,000) makes the true cost much higher.
    expect(trueApr({ principal: 20000, fee: 2000, emi, months: 6 })).toBeCloseTo(79.6, 1);
  });

  it('converts a daily quote to a nominal APR', () => {
    expect(dailyRateToApr(0.1)).toBeCloseTo(36.5, 6);
    expect(dailyRateToApr(0.05)).toBeCloseTo(18.25, 6);
  });

  it('never pretends a flat rate equals a reducing-balance APR', () => {
    const flat = normaliseRate({ balance: 20000, quote: { basis: 'flat', rate: 24, months: 6 } });
    expect(flat.source).toBe('flat');
    expect(flat.apr).toBeGreaterThan(24);
    expect(flat.note).toMatch(/true APR/i);
  });

  it('normalises a daily quote', () => {
    const daily = normaliseRate({ balance: 10000, quote: { basis: 'daily', rate: 0.1 } });
    expect(daily.source).toBe('daily');
    expect(daily.apr).toBeCloseTo(36.5, 6);
  });

  it('keeps an unknown rate unknown instead of inventing one', () => {
    expect(normaliseRate({ balance: 10000 })).toEqual({ apr: null, source: null });
    expect(normaliseRate({ balance: 10000, quote: { basis: 'mystery', rate: 5 } })).toEqual({ apr: null, source: null });
  });

  it('passes a plain APR through untouched', () => {
    expect(normaliseRate({ apr: 42 })).toEqual({ apr: 42, source: 'reducing' });
  });
});

describe('credit-stress indicators (C.2 / F-05)', () => {
  it('uses the real limit, never a 1.4x assumption', () => {
    const d = runDiagnosticV2({
      netIncome: 100000, coreExpenses: 20000, liquidReserves: 500000,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 65000, minPayment: 5000, apr: 42, creditLimit: 100000 }],
    });
    expect(d.metrics.cur).toBeCloseTo(65, 6);
    expect(d.metrics.cur).not.toBeCloseTo(71.4, 1);
  });

  it('reports utilisation as unknown when a limit is missing', () => {
    const d = runDiagnosticV2({
      netIncome: 100000, coreExpenses: 20000, liquidReserves: 500000,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 65000, minPayment: 5000, apr: 42 }],
    });
    expect(d.metrics.cur).toBeNull();
    expect(d.creditStress.utilisationStatus).toMatch(/unknown/);
  });

  it('counts only unsecured lines with a balance', () => {
    const d = runDiagnosticV2({
      netIncome: 200000, coreExpenses: 40000, liquidReserves: 500000,
      debts: [
        { name: 'home', type: 'installment', secured: true, balance: 4000000, minPayment: 40000, apr: 9 },
        { name: 'card', type: 'revolving', secured: false, balance: 20000, minPayment: 2000, apr: 42, creditLimit: 100000 },
        { name: 'closed card', type: 'revolving', secured: false, balance: 0, minPayment: 0, apr: 42, creditLimit: 50000 },
        { name: 'dummy none', type: 'installment', secured: false, balance: 0, minPayment: 0, apr: 0 },
      ],
    });
    expect(d.metrics.unsecuredLines).toBe(1);
    expect(d.metrics.securedLines).toBe(1);
    expect(d.creditStress.revolvingLines).toBe(1);
  });

  it('labels the block as credit-stress indicators, not a bureau report', () => {
    const d = runDiagnosticV2({ netIncome: 100000, coreExpenses: 20000, liquidReserves: 100000, debts: [] });
    expect(d.creditStress.label).toBe('Credit-stress indicators');
    expect(d.creditStress.note).toMatch(/not a credit score/i);
  });
});

describe('data-quality guards (C.9)', () => {
  it('flags total EMIs above income', () => {
    const d = runDiagnosticV2({
      netIncome: 30000, coreExpenses: 10000, liquidReserves: 0,
      debts: [{ name: 'a', type: 'loanapp', secured: false, balance: 100000, minPayment: 40000, apr: 36 }],
    });
    expect(d.warnings.some((w) => w.code === 'EMI_ABOVE_INCOME')).toBe(true);
  });

  it('flags core costs that are implausibly low', () => {
    const d = runDiagnosticV2({ netIncome: 100000, coreExpenses: 2000, liquidReserves: 100000, debts: [] });
    expect(d.warnings.some((w) => w.code === 'CORE_EXPENSES_LOW')).toBe(true);
  });

  it('flags a single amount above 10x monthly income', () => {
    const d = runDiagnosticV2({
      netIncome: 20000, coreExpenses: 8000, liquidReserves: 300000, debts: [],
    });
    expect(d.warnings.some((w) => w.code === 'SINGLE_AMOUNT_LARGE')).toBe(true);
  });

  it('flags reserves above 5 years of expenses', () => {
    const d = runDiagnosticV2({ netIncome: 100000, coreExpenses: 20000, liquidReserves: 20000000, debts: [] });
    expect(d.warnings.some((w) => w.code === 'RESERVES_LARGE')).toBe(true);
  });

  it('flags a balance that grows even when paid on time', () => {
    const d = runDiagnosticV2({
      netIncome: 100000, coreExpenses: 10000, liquidReserves: 100000,
      debts: [{ name: 'revolver', type: 'revolving', secured: false, balance: 100000, minPayment: 3000, apr: 48, creditLimit: 200000 }],
    });
    expect(d.warnings.some((w) => w.code === 'NEGATIVE_AMORTISATION')).toBe(true);
  });

  it('never modifies the data it flags', () => {
    const input = { netIncome: 100000, coreExpenses: 2000, liquidReserves: 100000, debts: [] };
    const copy = JSON.parse(JSON.stringify(input));
    runDiagnosticV2(input);
    expect(input).toEqual(copy);
  });

  it('reports a missing rate instead of assuming 0%', () => {
    const d = runDiagnosticV2({
      netIncome: 100000, coreExpenses: 20000, liquidReserves: 100000,
      debts: [{ name: 'mystery', type: 'installment', secured: false, balance: 50000, minPayment: 5000, apr: null }],
    });
    expect(d.warnings.some((w) => w.code === 'RATE_UNKNOWN')).toBe(true);
  });

  it('asks about an implausibly high rate rather than accepting it silently', () => {
    const d = runDiagnosticV2({
      netIncome: 100000, coreExpenses: 20000, liquidReserves: 100000,
      debts: [{ name: 'odd', type: 'installment', secured: false, balance: 50000, minPayment: 5000, apr: 300 }],
    });
    expect(d.questions.some((q) => /per year or per month/.test(q.message))).toBe(true);
  });

  it('refuses to diagnose without an income', () => {
    const d = runDiagnosticV2({ netIncome: 0, coreExpenses: 1000, debts: [] });
    expect(d.ok).toBe(false);
    expect(d.error).toBe('INVALID_INCOME');
  });
});

describe('income history uses the weakest recent month (C.4)', () => {
  it('does not let a good month hide a bad one', () => {
    const base = { rent: 20000, coreExpenses: 20000, liquidReserves: 200000, debts: [] };
    const steady = runDiagnosticV2({ ...base, netIncome: 100000, incomeHistory: [] });
    const irregular = runDiagnosticV2({ ...base, netIncome: 100000, incomeHistory: [60000, 45000, 90000] });
    expect(steady.metrics.incomeEff).toBe(100000);
    expect(irregular.metrics.incomeEff).toBe(45000);
    expect(irregular.metrics.foir).toBeGreaterThan(steady.metrics.foir);
  });
});

describe('directives and career risk (C.7, C.8)', () => {
  const tiers = [1, 2, 3, 4];

  it('uses advisory wording and never the forbidden words', () => {
    for (const tier of tiers) {
      const text = JSON.stringify(DIRECTIVES[tier]).toLowerCase();
      expect(text, `tier ${tier}`).not.toContain('prohibited');
      expect(text, `tier ${tier}`).not.toContain('insolvent');
      expect(text.length, `tier ${tier} has content`).toBeGreaterThan(40);
    }
  });

  it('every tier directive is reachable from a real profile', () => {
    const seen = new Set();
    for (const tier of tiers) {
      const d = runDiagnosticV2({
        netIncome: 100000, rent: (tier - 1) * 22000, coreExpenses: 10000,
        liquidReserves: tier >= 4 ? 0 : 500000, debts: [],
      });
      seen.add(d.tier);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('keeps tier 1 out of the investment-advice perimeter', () => {
    const d = runDiagnosticV2({ netIncome: 200000, coreExpenses: 40000, liquidReserves: 2000000, debts: [] });
    expect(d.tier).toBe(1);
    expect(d.directives.next30).toMatch(/SEBI-registered adviser/i);
  });

  it('treats the career rule as income variance, not a ban on entrepreneurship', () => {
    expect(CAREER_RISK.permitted).toMatch(/equal or higher fixed pay/i);
    expect(JSON.stringify(CAREER_RISK)).not.toMatch(/prohibit/i);

    const risky = runDiagnosticV2({
      netIncome: 100000, rent: 45000, coreExpenses: 20000, liquidReserves: 50000, debts: [],
    });
    expect(risky.career.applies).toBe(true);
    expect(risky.career.adviseAgainst).toContain('commission-only income');
  });

  it('does not apply the career rule to a comfortable profile', () => {
    const d = runDiagnosticV2({ netIncome: 200000, coreExpenses: 30000, rent: 10000, liquidReserves: 1500000, debts: [] });
    expect(d.career.applies).toBe(false);
    expect(d.career.adviseAgainst).toEqual([]);
  });
});

describe('distance to the next better tier (C.5)', () => {
  it('names the smallest single change', () => {
    const d = runDiagnosticV2({
      netIncome: 100000, rent: 0, coreExpenses: 20000, liquidReserves: 10000,
      debts: [{ name: 'loan', type: 'installment', secured: false, balance: 200000, minPayment: 5000, apr: 12 }],
    });
    expect(d.tier).toBe(2);
    expect(d.distance.applicable).toBe(true);
    expect(d.distance.targetTier).toBe(1);
    expect(d.distance.best).toBeTruthy();
    expect(d.distance.best.amount).toBeGreaterThan(0);
  });

  it('says so when already in the best tier', () => {
    const d = runDiagnosticV2({ netIncome: 200000, coreExpenses: 20000, rent: 0, liquidReserves: 2000000, debts: [] });
    expect(distanceToNextTier(1, d.metrics).applicable).toBe(false);
  });
});

describe('explainability', () => {
  it('explains the verdict and lists the drivers', () => {
    const d = runDiagnosticV2({
      netIncome: 45000, rent: 0, coreExpenses: 22000, liquidReserves: 10000,
      debts: [{ name: 'loan', type: 'installment', secured: false, balance: 300000, minPayment: 28000, apr: 18 }],
    });
    expect(d.tier).toBe(4);
    expect(d.drivers).toContain('DCF');
    expect(d.explanation.join(' ')).toMatch(/Flow tier/);
  });
});
