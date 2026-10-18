import { describe, it, expect } from 'vitest';
import { runDiagnosticV2 } from '../../core/engine_v2.js';
import { POLICY, tierUp, tierDown } from '../../core/policy.js';

/**
 * Every band edge from Part II G.2.
 *
 * Bands are half-open: a value exactly ON a cut-off belongs to the worse tier. The
 * documented table gives the tier of the METRIC; the final tier then follows the
 * combination rule (flow decides, a thin buffer may worsen by at most one). Both are
 * asserted here so neither can drift.
 */

/** Build a profile that isolates one metric. */
function withRent(rent, income = 100000) {
  // No debts, so FOIR comes entirely from rent. Large reserves keep runway at tier 1.
  return {
    netIncome: income,
    rent,
    coreExpenses: 0,
    liquidReserves: 10 * income,
    debts: [],
  };
}

function withCore(core, income = 100000) {
  return { netIncome: income, rent: 0, coreExpenses: core, liquidReserves: 100 * income, debts: [] };
}

function withReserves(reserves, { income = 100000, core = 50000 } = {}) {
  return { netIncome: income, rent: 0, coreExpenses: core, liquidReserves: reserves, debts: [] };
}

describe('FOIR band edges', () => {
  const cases = [[39.99, 1], [40, 2], [50, 3], [65, 4]];
  for (const [pctValue, expected] of cases) {
    it(`FOIR ${pctValue}% -> tier ${expected}`, () => {
      const d = runDiagnosticV2(withRent((pctValue / 100) * 100000));
      expect(d.tiers.foir).toBe(expected);
      expect(d.metrics.foir).toBeCloseTo(pctValue, 6);
    });
  }

  it('the tier helper agrees at every edge', () => {
    expect(tierUp(39.99, POLICY.foirCuts)).toBe(1);
    expect(tierUp(40, POLICY.foirCuts)).toBe(2);
    expect(tierUp(50, POLICY.foirCuts)).toBe(3);
    expect(tierUp(65, POLICY.foirCuts)).toBe(4);
  });
});

describe('DCF band edges', () => {
  const cases = [[25, 1], [24.99, 2], [10, 2], [9.99, 3], [0, 3]];
  for (const [pctValue, expected] of cases) {
    it(`DCF ${pctValue}% -> tier ${expected}`, () => {
      const core = 100000 - (pctValue / 100) * 100000;
      const d = runDiagnosticV2(withCore(core));
      expect(d.tiers.dcf).toBe(expected);
      expect(d.metrics.dcfPct).toBeCloseTo(pctValue, 6);
    });
  }

  it('the tier helper agrees at every edge', () => {
    expect(tierDown(25, POLICY.dcfPctCuts)).toBe(1);
    expect(tierDown(24.99, POLICY.dcfPctCuts)).toBe(2);
    expect(tierDown(10, POLICY.dcfPctCuts)).toBe(2);
    expect(tierDown(9.99, POLICY.dcfPctCuts)).toBe(3);
    expect(tierDown(0, POLICY.dcfPctCuts)).toBe(3);
  });
});

describe('deficit horizon: reserves / monthly shortfall', () => {
  // income 50,000; core 40,000; minimum 11,000 -> shortfall 1,000/month exactly.
  const deficitProfile = (reserves) => ({
    netIncome: 50000,
    rent: 0,
    coreExpenses: 40000,
    liquidReserves: reserves,
    debts: [{ name: 'x', type: 'installment', secured: false, balance: 100000, minPayment: 11000, apr: 12 }],
  });

  it('5.99 months of reserves -> tier 4', () => {
    const d = runDiagnosticV2(deficitProfile(5990));
    expect(d.metrics.monthsToDefault).toBeCloseTo(5.99, 6);
    expect(d.tiers.dcf).toBe(4);
  });

  it('6.0 months of reserves -> tier 3', () => {
    const d = runDiagnosticV2(deficitProfile(6000));
    expect(d.metrics.monthsToDefault).toBeCloseTo(6.0, 6);
    expect(d.tiers.dcf).toBe(3);
  });
});

describe('runway band edges', () => {
  const cases = [[6, 1], [5.99, 2], [3, 2], [2.99, 3], [1, 3], [0.99, 4]];
  for (const [monthsValue, expected] of cases) {
    it(`runway ${monthsValue} months -> tier ${expected}`, () => {
      const d = runDiagnosticV2(withReserves(monthsValue * 50000));
      expect(d.tiers.runway).toBe(expected);
      expect(d.metrics.er).toBeCloseTo(monthsValue, 6);
    });
  }

  it('the tier helper agrees at every edge', () => {
    expect(tierDown(6, POLICY.erCuts)).toBe(1);
    expect(tierDown(5.99, POLICY.erCuts)).toBe(2);
    expect(tierDown(3, POLICY.erCuts)).toBe(2);
    expect(tierDown(2.99, POLICY.erCuts)).toBe(3);
    expect(tierDown(1, POLICY.erCuts)).toBe(3);
    expect(tierDown(0.99, POLICY.erCuts)).toBe(4);
  });
});

describe('combination rule (F-01)', () => {
  it('a thin buffer worsens a flow tier by at most one level', () => {
    // Flow tier 1 (healthy FOIR and DCF) but runway under 1 month -> tier 2, not 4.
    const d = runDiagnosticV2(withReserves(1000, { core: 50000 }));
    expect(d.flowTier).toBe(1);
    expect(d.tiers.runway).toBe(4);
    expect(d.tier).toBe(2);
    expect(d.notes.join(' ')).toMatch(/Runway-limited/);
  });

  it('a healthy buffer can never improve a bad flow tier', () => {
    // FOIR 70% -> flow tier 4; huge reserves must not help.
    const d = runDiagnosticV2({
      netIncome: 100000, rent: 70000, coreExpenses: 0, liquidReserves: 100000000, debts: [],
    });
    expect(d.flowTier).toBe(4);
    expect(d.tiers.runway).toBe(1);
    expect(d.tier).toBe(4);
  });

  it('reproduces the review\'s headline defect fix: healthy flow, 0.4-month buffer is NOT tier 1', () => {
    // Income 1,00,000; core 20,000; EMI 5,000; reserves 10,000 (Part II B.2).
    const d = runDiagnosticV2({
      netIncome: 100000, rent: 0, coreExpenses: 20000, liquidReserves: 10000,
      debts: [{ name: 'loan', type: 'installment', secured: false, balance: 200000, minPayment: 5000, apr: 12 }],
    });
    expect(d.metrics.er).toBeCloseTo(0.4, 2);
    expect(d.flowTier).toBe(1);
    expect(d.tier).toBe(2);
  });
});

describe('overrides', () => {
  it('a minimum at or below monthly interest forces at least tier 3', () => {
    const d = runDiagnosticV2({
      netIncome: 100000, rent: 0, coreExpenses: 5000, liquidReserves: 900000,
      debts: [{ name: 'grower', type: 'revolving', secured: false, balance: 200000, minPayment: 2000, apr: 36, creditLimit: 500000 }],
    });
    expect(d.tier).toBeGreaterThanOrEqual(3);
    expect(d.notes.join(' ')).toMatch(/Balance growing on/);
  });

  it('dependency load >= 0.5 with runway < 3 raises the tier by one', () => {
    const base = { netIncome: 100000, rent: 0, coreExpenses: 10000, liquidReserves: 20000, debts: [] };
    const without = runDiagnosticV2({ ...base, earners: 1, dependents: 0 });
    const with_ = runDiagnosticV2({ ...base, earners: 1, dependents: 3 });
    expect(with_.tier - without.tier).toBe(1);
  });

  it('dependency escalation is capped at tier 4', () => {
    const d = runDiagnosticV2({
      netIncome: 50000, rent: 30000, coreExpenses: 15000, liquidReserves: 1000,
      earners: 1, dependents: 5,
      debts: [],
    });
    expect(d.tier).toBe(4);
  });

  it('family help never improves the tier', () => {
    const base = { netIncome: 100000, rent: 0, coreExpenses: 10000, liquidReserves: 20000, earners: 1, dependents: 3, debts: [] };
    const without = runDiagnosticV2({ ...base, familyHelp: false });
    const with_ = runDiagnosticV2({ ...base, familyHelp: true });
    expect(with_.tier).toBe(without.tier);
    expect(with_.notes.join(' ')).toMatch(/contingent buffer/);
  });
});

describe('tier 4 naming', () => {
  it('is called "Acute cash-flow crisis" and never "insolvent"', () => {
    const d = runDiagnosticV2({
      netIncome: 22000, rent: 0, coreExpenses: 12000, liquidReserves: 0,
      debts: [{ name: 'app', type: 'loanapp', secured: false, balance: 120000, minPayment: 14000, apr: 36 }],
    });
    expect(d.tier).toBe(4);
    expect(d.tierLabel).toBe('Acute cash-flow crisis');
    expect(JSON.stringify(d).toLowerCase()).not.toContain('insolvent');
  });
});
