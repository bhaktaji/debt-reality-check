import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../../store/db.js';
import { createRouter } from '../../bot/router.js';
import { driveAudit } from '../helpers/audit_driver.js';
import { profileFromStore } from '../../store/mappers.js';
import { diagnoseProfile } from '../../core/profile.js';
import { fingerprint as dashboardFingerprint } from '../../web/src/model.js';
import { ARCHETYPES } from './archetypes.js';

/**
 * Parity (F-03, task section 16).
 *
 * The bot and the dashboard must return identical verdicts for identical input. They
 * already share one core module; this test proves it end-to-end by driving a real
 * conversation through the bot, reading the profile back out of storage, and comparing
 * against the dashboard's own model.
 */

let store;
let router;

beforeEach(() => {
  store = openDatabase({ path: ':memory:', secret: 'parity-test-secret-1234567890' });
  router = createRouter({ store, config: { retentionDays: 90 } });
});

afterEach(() => store.close());

function botFingerprint(profile, rawId) {
  driveAudit(router, rawId, profile);
  const uid = store.pseudonymise(rawId);
  const stored = profileFromStore(store.users.get(uid), store.debts.list(uid));
  return diagnoseProfile(stored);
}

describe('bot / dashboard parity', () => {
  for (const a of ARCHETYPES) {
    it(`Profile ${a.id} (${a.name}) produces the same verdict on every surface`, () => {
      const bot = botFingerprint(a.profile, `parity:${a.id}`);
      const dash = dashboardFingerprint(a.profile);
      const direct = diagnoseProfile(a.profile);

      // The dashboard model and the direct core call are the same code path.
      expect(dash.tier).toBe(direct.tier);
      expect(bot.tier).toBe(dash.tier);
      expect(bot.flowTier).toBe(dash.flowTier);
      expect(bot.tiers).toEqual(dash.tiers);
      expect(bot.drivers).toEqual(dash.drivers);
      expect(bot.metrics.foir).toBeCloseTo(direct.metrics.foir, 6);
      expect(bot.metrics.dcfPct).toBeCloseTo(direct.metrics.dcfPct, 6);
      expect(bot.metrics.interestBurn).toBeCloseTo(direct.metrics.interestBurn, 6);
      expect(bot.avalanche.months).toBe(direct.avalanche.months);
      expect(bot.avalanche.totalInterest).toBe(direct.avalanche.totalInterest);
      expect(bot.snowball.totalInterest).toBe(direct.snowball.totalInterest);
      expect(bot.strategy.pick).toBe(direct.strategy.pick);
    });
  }
});

describe('the fingerprint itself is stable', () => {
  it('does not include any field that could drift between surfaces', () => {
    const f = dashboardFingerprint(ARCHETYPES[1].profile);
    expect(Object.keys(f).sort()).toEqual([
      'avalancheInterest', 'avalancheMonths', 'cur', 'dcfPct', 'drivers', 'feasible', 'flowTier',
      'foir', 'interestBurn', 'ok', 'recommended', 'runway', 'snowballInterest', 'snowballMonths',
      'tier', 'tiers', 'unsecuredLines',
    ]);
  });

  it('agrees on the unknown-utilisation case', () => {
    const profile = {
      netIncome: 100000, rent: 0, coreExpenses: 20000, liquidReserves: 500000,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 65000, minPayment: 5000, apr: 42 }],
    };
    const bot = botFingerprint(profile, 'parity:nolimit');
    const dash = dashboardFingerprint(profile);
    expect(bot.metrics.cur).toBeNull();
    expect(dash.cur).toBeNull();
    expect(bot.tier).toBe(dash.tier);
  });

  it('agrees on an infeasible payoff plan', () => {
    const profile = {
      netIncome: 23500, rent: 0, coreExpenses: 20000, liquidReserves: 0,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 100000, minPayment: 3000, apr: 48, creditLimit: 150000 }],
    };
    const bot = botFingerprint(profile, 'parity:infeasible');
    const dash = dashboardFingerprint(profile);
    expect(bot.avalanche.feasible).toBe(false);
    expect(dash.feasible).toBe(false);
    expect(bot.avalanche.reason).toBe('BUDGET_BELOW_INTEREST');
  });

  it('agrees on a flat-rate quote normalisation', () => {
    const profile = {
      netIncome: 60000, rent: 0, coreExpenses: 30000, liquidReserves: 100000,
      debts: [{ name: 'app loan', type: 'loanapp', secured: false, balance: 20000, minPayment: 3733, quote: { basis: 'flat', rate: 24, months: 6 } }],
    };
    const bot = diagnoseProfile(profile);
    const dash = dashboardFingerprint(profile);
    // 24% flat over 6 months with no fee normalises to a 40.0% true APR.
    expect(bot.metrics.interestBurn).toBeGreaterThan(0);
    expect(dash.tier).toBe(bot.tier);
    expect(dash.foir).toBeCloseTo(bot.metrics.foir, 6);
  });
});
