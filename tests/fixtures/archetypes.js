/**
 * tests/fixtures/archetypes.js
 * The four household archetypes from the whitepaper (section 8) with the v2 outcomes
 * recomputed in Part II section G.1. Shared by every test suite (unit, property, parity)
 * and by the CLI demo, so there is exactly one definition of "correct".
 *
 * Reserves are back-solved from the stated runways: A 10,000; B 1,81,500; C 3,00,000; D nil.
 */

export const ARCHETYPES = [
  {
    id: 'A',
    name: 'Sole Earner',
    profile: {
      netIncome: 45000,
      incomeHistory: [],
      rent: 0,
      coreExpenses: 22000,
      liquidReserves: 10000,
      earners: 1,
      dependents: 2,
      familyHelp: false,
      debts: [
        { name: 'Personal loan', type: 'installment', secured: false, balance: 300000, minPayment: 28000, apr: 18 },
      ],
    },
    expected: {
      foir: 62.2,
      dcfPct: -11.1,
      runway: 0.2,
      monthsToDefault: 2.0,
      flowTier: 4,
      tier: 4,
      drivers: ['DCF', 'Runway'],
      tierLabel: 'Acute cash-flow crisis',
      careerRiskApplies: true,
    },
  },
  {
    id: 'B',
    name: 'Dual-Income Urban',
    profile: {
      netIncome: 200000,
      incomeHistory: [],
      rent: 0,
      coreExpenses: 65000,
      liquidReserves: 181500,
      earners: 2,
      dependents: 1,
      familyHelp: false,
      debts: [
        { name: 'Home loan', type: 'installment', secured: true, balance: 4000000, minPayment: 70000, apr: 9 },
        { name: 'Credit card', type: 'revolving', secured: false, balance: 200000, minPayment: 30000, apr: 42, creditLimit: 250000 },
      ],
    },
    expected: {
      foir: 50.0,
      dcfPct: 17.5,
      runway: 1.1,
      flowTier: 3,
      tier: 3,
      drivers: ['FOIR', 'Runway'],
      tierLabel: 'Critical debt trap',
      careerRiskApplies: true,
    },
  },
  {
    id: 'C',
    name: 'Aspiring Founder',
    profile: {
      netIncome: 160000,
      incomeHistory: [],
      rent: 0,
      coreExpenses: 55000,
      liquidReserves: 300000,
      earners: 1,
      dependents: 0,
      familyHelp: false,
      debts: [
        { name: 'Business loan', type: 'installment', secured: true, balance: 1200000, minPayment: 77000, apr: 14 },
      ],
    },
    expected: {
      foir: 48.1,
      dcfPct: 17.5,
      runway: 2.27,
      flowTier: 2,
      tier: 3, // runway-limited: was Tier 2 under v1
      drivers: ['Runway'],
      tierLabel: 'Critical debt trap',
      careerRiskApplies: true,
    },
  },
  {
    id: 'D',
    name: 'Predatory App Spiral',
    profile: {
      netIncome: 22000,
      incomeHistory: [],
      rent: 0,
      coreExpenses: 12000,
      liquidReserves: 0,
      earners: 1,
      dependents: 3,
      familyHelp: true, // contingent support: must NOT improve the tier
      debts: [
        { name: 'Loan app A', type: 'loanapp', secured: false, balance: 120000, minPayment: 14000, apr: 36 },
        { name: 'BNPL', type: 'bnpl', secured: false, balance: 40000, minPayment: 10000, apr: 30 },
      ],
    },
    expected: {
      foir: 109.1,
      dcfPct: -63.6,
      runway: 0.0,
      monthsToDefault: 0,
      flowTier: 4,
      tier: 4,
      drivers: ['FOIR', 'DCF', 'Runway'],
      tierLabel: 'Acute cash-flow crisis',
      careerRiskApplies: true,
    },
  },
];

export const ARCHETYPE_BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

export default ARCHETYPES;
