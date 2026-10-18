import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../../store/db.js';
import { createRouter } from '../../bot/router.js';
import { profileFromStore } from '../../store/mappers.js';
import { diagnoseProfile } from '../../core/profile.js';
import { buildReport, toTextReport } from '../../core/report.js';
import * as M from '../../bot/messages.js';
import { ARCHETYPE_BY_ID } from '../fixtures/archetypes.js';

/**
 * The beginner path.
 *
 * Someone who has never heard of FOIR, DCF or APR must be able to complete the whole audit
 * and understand the answer. These tests drive the real router with plain answers and check
 * both what comes back and what gets stored.
 */

const JARGON = [/\bFOIR\b/, /\bDCF\b/, /\bDASI\b/, /\bAPR\b/, /amortis/i, /\bDTI\b/, /interest burn/i, /\bdependency load\b/i];

let store;
let router;
const RAW = 'beginner:user';

beforeEach(() => {
  store = openDatabase({ path: ':memory:', secret: 'ux-test-secret-1234567890' });
  router = createRouter({ store, config: { retentionDays: 90 } });
});

afterEach(() => store.close());

const send = (text) => router.handle(RAW, text).replies.join('\n');

/** Everything a beginner has to do, in order. */
function completeAudit({ creditLimitAnswer = '1,00,000' } = {}) {
  send('AGREE');
  send('AUDIT');
  send('60000');
  send('yes');
  send('no'); // income is not stable
  send('58000, 60000, 54000');
  send('12000');
  send('yes');
  send('28000');
  send('yes');
  send('40000');
  send('yes');
  send('1');
  send('2');
  send('no');
  // debt 1: a credit card
  send('HDFC credit card');
  send('1');
  send('no');
  send('65000');
  send('yes');
  send('3500');
  send('yes');
  send('42');
  if (creditLimitAnswer) {
    send(creditLimitAnswer);
    send('yes');
  } else {
    send('skip');
  }
  // debt 2: a personal loan
  send('Personal loan');
  send('2');
  send('no');
  send('120000');
  send('yes');
  send('4500');
  send('yes');
  send('16');
  send('done');
  return send('DONE');
}

describe('the questions themselves', () => {
  it('never use finance jargon', () => {
    const all = Object.values(M.AUDIT_QUESTIONS).join('\n');
    for (const re of JARGON) expect(re.test(all), String(re)).toBe(false);
  });

  it('ask about income in everyday words and say what to do if it varies', () => {
    expect(M.AUDIT_QUESTIONS.netIncome).toMatch(/money comes into your household each month/i);
    expect(M.AUDIT_QUESTIONS.netIncome).toMatch(/actually receive/i);
    expect(M.AUDIT_QUESTIONS.incomeHistory).toMatch(/last 3 to 6 monthly amounts/i);
  });

  it('make the rent and loan-payment split explicit', () => {
    expect(M.AUDIT_QUESTIONS.coreExpenses).toMatch(/Leave out rent and loan payments/i);
  });

  it('explain the buffer question without jargon', () => {
    expect(M.AUDIT_QUESTIONS.liquidReserves).toMatch(/if your income stopped/i);
    expect(M.AUDIT_QUESTIONS.liquidReserves).toMatch(/reach within a few days/i);
  });

  it('tell the user they may say they do not know the credit limit', () => {
    expect(M.AUDIT_QUESTIONS.debtCreditLimit).toMatch(/SKIP/);
    expect(M.AUDIT_QUESTIONS.debtCreditLimit).toMatch(/will not guess/i);
  });
});

describe('a beginner completes the whole audit', () => {
  it('reaches a result without ever meeting a finance term', () => {
    const reply = completeAudit();
    expect(reply).toContain('YOUR DEBT REALITY CHECK');
    expect(reply).toMatch(/You're in /);
    expect(reply).toContain('WHAT I WOULD FOCUS ON NEXT');
    for (const re of JARGON) expect(re.test(reply.split('TECHNICAL DETAIL')[0]), `leaked ${re}`).toBe(false);
  });

  it('stores exactly what was entered', () => {
    completeAudit();
    const uid = store.pseudonymise(RAW);
    const stored = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(stored.netIncome).toBe(60000);
    expect(stored.incomeHistory).toEqual([58000, 60000, 54000]);
    expect(stored.rent).toBe(12000);
    expect(stored.coreExpenses).toBe(28000);
    expect(stored.liquidReserves).toBe(40000);
    expect(stored.earners).toBe(1);
    expect(stored.dependents).toBe(2);
    expect(stored.familyHelp).toBe(false);
    expect(stored.debts).toHaveLength(2);
    expect(stored.debts[0]).toMatchObject({ type: 'revolving', secured: false, balance: 65000, minPayment: 3500, apr: 42, creditLimit: 100000 });
    expect(stored.debts[1]).toMatchObject({ type: 'installment', secured: false, balance: 120000, apr: 16 });
  });

  it('uses the weakest recent month, not the best one', () => {
    completeAudit();
    const uid = store.pseudonymise(RAW);
    const stored = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(diagnoseProfile(stored).metrics.incomeEff).toBe(54000);
  });

  it('shows a payoff plan in plain words', () => {
    const reply = completeAudit();
    expect(reply).toContain('YOUR DEBT PAYOFF PLAN');
    expect(reply).toMatch(/Highest-interest first|no realistic payoff plan/i);
  });

  it('gives the user next actions they can act on', () => {
    const reply = completeAudit();
    const actions = reply.split('WHAT I WOULD FOCUS ON NEXT')[1].split('YOUR DEBT PAYOFF PLAN')[0];
    const numbered = actions.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    expect(numbered.length).toBeGreaterThanOrEqual(3);
    expect(numbered.length).toBeLessThanOrEqual(5);
  });
});

describe('an unknown credit limit stays unknown', () => {
  it('accepts SKIP and never invents a limit', () => {
    completeAudit({ creditLimitAnswer: null });
    const uid = store.pseudonymise(RAW);
    const stored = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(stored.debts[0].creditLimit).toBeNull();

    const diagnostic = diagnoseProfile(stored);
    expect(diagnostic.metrics.cur).toBeNull();
    expect(diagnostic.creditStress.utilisationStatus).toMatch(/unknown/);
  });

  it('says so plainly in the report rather than estimating', () => {
    completeAudit({ creditLimitAnswer: null });
    const uid = store.pseudonymise(RAW);
    const stored = profileFromStore(store.users.get(uid), store.debts.list(uid));
    const report = buildReport(diagnoseProfile(stored));
    const utilisation = report.metricsExplained.find((m) => m.key === 'creditUtilisation');
    expect(utilisation.available).toBe(false);
    expect(utilisation.why).toMatch(/did not provide a credit limit/i);
    expect(toTextReport(report)).toMatch(/will not guess|did not provide a credit limit/i);
  });
});

describe('forgiving input', () => {
  it('accepts Indian shorthand for money', () => {
    send('AGREE');
    send('AUDIT');
    expect(send('1.5 lakh')).toMatch(/₹1,50,000 per month. Correct\?/);
    send('yes');
    expect(send('skip')).toMatch(/monthly rent or housing payment/i);
    expect(send('0')).toMatch(/Correct\?/);
    send('yes');
    expect(send('25k')).toMatch(/₹25,000 per month. Correct\?/);
  });

  it('never turns a malformed amount into zero', () => {
    send('AGREE');
    send('AUDIT');
    const reply = send('12abc');
    expect(reply).toMatch(/could not read that as an amount|not one I recognise/i);
    expect(reply).not.toMatch(/₹0/);
  });

  it('asks a plain clarification when a message holds two amounts', () => {
    send('AGREE');
    send('AUDIT');
    const reply = send('60000, 55000');
    expect(reply).toMatch(/more than one number|just the amount/i);
  });

  it('never records a zero-amount expense from unreadable text', () => {
    send('AGREE');
    send('medicine 12abc');
    const uid = store.pseudonymise(RAW);
    expect(store.expenses.listAll(uid)).toHaveLength(0);
  });
});

describe('the REPORT command reuses the shared narrative', () => {
  it('returns the same story the dashboard would show', () => {
    completeAudit();
    const reply = send('REPORT');
    expect(reply).toContain("HERE'S THE SITUATION");
    expect(reply).toContain('WHAT THIS MEANS');
    expect(reply).toContain('WHAT I WOULD FOCUS ON NEXT');
    expect(reply).toContain('ASSUMPTIONS AND LIMITATIONS');
    // The exact figures remain available in the appendix.
    expect(reply).toContain('TECHNICAL DETAIL');
    expect(reply).toMatch(/Tier \d of 4/);
  });

  it('agrees with the engine for a known fixture', () => {
    const uid = store.pseudonymise('beginner:fixture');
    store.users.ensure(uid);
    const profile = ARCHETYPE_BY_ID.C.profile;
    store.debts.replaceAll(uid, profile.debts);
    store.users.update(uid, {
      net_income_paise: profile.netIncome * 100,
      core_expenses_paise: profile.coreExpenses * 100,
      rent_paise: 0,
      liquid_reserves_paise: profile.liquidReserves * 100,
    });
    const stored = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(diagnoseProfile(stored).tier).toBe(3);
  });
});
