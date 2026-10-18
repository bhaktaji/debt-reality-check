import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../../store/db.js';
import { createRouter } from '../../bot/router.js';
import { driveAudit } from '../helpers/audit_driver.js';
import { ARCHETYPE_BY_ID } from '../fixtures/archetypes.js';
import { profileFromStore } from '../../store/mappers.js';
import { diagnoseProfile } from '../../core/profile.js';
import { parseExpense } from '../../core/expense_parser.js';
import * as M from '../../bot/messages.js';

const SECRET = 'router-test-secret-value-123456';
let store;
let router;
const RAW = 'test:user-1';

beforeEach(() => {
  store = openDatabase({ path: ':memory:', secret: SECRET });
  router = createRouter({ store, config: { retentionDays: 90 } });
});

afterEach(() => store.close());

const send = (text, rawId = RAW) => router.handle(rawId, text).replies.join('\n');

describe('first contact and consent (F.3)', () => {
  it('shows the notice before doing anything else', () => {
    const out = send('medicine 400');
    expect(out).toContain('Debt Reality Check');
    expect(out).toContain('DELETE MY DATA');
    expect(out).toContain('one-way hash');
  });

  it('answers HELP without consent', () => {
    expect(send('HELP')).toContain('COMMANDS');
  });

  it('records consent on AGREE', () => {
    send('AGREE');
    const uid = store.pseudonymise(RAW);
    expect(store.consent.hasConsent(uid)).toBe(true);
    expect(store.consent.latest(uid).retentionDays).toBe(90);
  });

  it('refuses an audit before consent', () => {
    expect(send('AUDIT')).toContain('AGREE');
  });
});

describe('audit conversation', () => {
  it('asks for every v2 field, including rent, income history, earners and family help', () => {
    send('AGREE');
    const intro = send('AUDIT');
    expect(intro).toMatch(/take-home income/i);
    expect(intro).toMatch(/CANCEL/);

    const afterIncome = send('45000');
    expect(afterIncome).toMatch(/₹45,000 per month. Correct\?/);

    const q2 = send('yes');
    expect(q2).toMatch(/income varies|last 3 to 6/i);

    send('skip');
    expect(send('12000')).toMatch(/Correct\?/);
    send('yes');
    expect(send('22000')).toMatch(/Correct\?/);
    send('yes');
    expect(send('10000')).toMatch(/Correct\?/);
    send('yes');
    expect(send('1')).toMatch(/depend financially on this household income/i);
    send('0');
    expect(send('no')).toMatch(/Debt name|debts/i);
  });

  it('completes a full audit and stores the profile and an audit snapshot', () => {
    const profile = ARCHETYPE_BY_ID.C.profile;
    driveAudit(router, RAW, profile);

    const uid = store.pseudonymise(RAW);
    const stored = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(stored.netIncome).toBe(profile.netIncome);
    expect(stored.rent).toBe(profile.rent);
    expect(stored.debts).toHaveLength(1);

    const expected = diagnoseProfile(profile);
    expect(store.audits.list(uid)[0].tier).toBe(expected.tier);
  });

  it('echoes the debt balance and minimum before accepting them', () => {
    send('AGREE');
    send('AUDIT');
    for (const a of ['45000', 'yes', 'skip', '12000', 'yes', '22000', 'yes', '10000', 'yes', '1', '0', 'no']) send(a);
    expect(send('HDFC card')).toMatch(/What kind of debt is it\?/);
    send('1');
    expect(send('no')).toMatch(/How much do you still owe\?/);
    expect(send('65,000')).toMatch(/₹65,000\. Correct\?/);
    expect(send('yes')).toMatch(/minimum payment/i);
  });

  it('asks for a credit limit on revolving debt and not otherwise', () => {
    send('AGREE');
    send('AUDIT');
    for (const a of ['45000', 'yes', 'skip', '12000', 'yes', '22000', 'yes', '10000', 'yes', '1', '0', 'no']) send(a);
    send('Personal loan');
    send('2'); // a personal loan is a fixed instalment, so no credit limit is asked for
    send('no');
    send('100000');
    send('yes');
    send('5000');
    send('yes');
    const afterApr = send('18');
    expect(afterApr).toMatch(/Added Personal loan/);
    expect(afterApr).not.toMatch(/Credit limit/);
  });

  it('BACK steps to the previous question', () => {
    send('AGREE');
    send('AUDIT');
    send('45000');
    send('yes');
    expect(send('BACK')).toMatch(/Stepped back/);
  });

  it('CANCEL abandons the flow without losing stored data', () => {
    send('AGREE');
    send('AUDIT');
    expect(send('CANCEL')).toMatch(/Cancelled/);
    // Back to idle: an expense now logs normally.
    expect(send('medicine 400')).toMatch(/Logged/);
  });
});

describe('expense logging at any stage (task section 14)', () => {
  it('logs an expense in idle mode', () => {
    send('AGREE');
    expect(send('medicine 400')).toMatch(/Logged ₹400 - Health \(essential\)/);
  });

  it('logs an expense mid-audit when the message is not a usable answer', () => {
    send('AGREE');
    send('AUDIT');
    send('45000');
    send('yes');
    // We are on the income-history step; this is clearly an expense, not a list of amounts.
    const out = send('electricity 1500');
    expect(out).toMatch(/Logged ₹1,500 - Utilities/);
    expect(out).toMatch(/could not read every amount|comma separated/i); // the step is re-asked
    expect(store.expenses.listAll(store.pseudonymise(RAW))).toHaveLength(1);
  });

  it('asks the user to classify uncategorised spend instead of guessing', () => {
    send('AGREE');
    expect(send('cola 40')).toMatch(/uncategorised/i);
    expect(send('E')).toMatch(/Logged ₹40/);
  });

  it('confirms the amount when several numbers appear', () => {
    send('AGREE');
    expect(send('2 eggs 30')).toMatch(/I read that as ₹30/);
    expect(send('yes')).toMatch(/Logged ₹30 - Groceries/);
  });

  it('replies rather than staying silent on an unreadable message', () => {
    send('AGREE');
    expect(send('hello there')).toMatch(/could not read an amount/i);
  });
});

describe('commands', () => {
  beforeEach(() => {
    send('AGREE');
  });

  it('SUMMARY reports today and the 30-day window', () => {
    send('electricity 1500');
    send('milk 200');
    const out = send('SUMMARY');
    expect(out).toContain('SPENDING SUMMARY');
    expect(out).toMatch(/Today: ₹1,700/);
    expect(out).toMatch(/Essential/);
    expect(out).toMatch(/not a cut target/);
  });

  it('REPORT and HISTORY explain the absence of an audit', () => {
    expect(send('REPORT')).toMatch(/No audit yet/);
    expect(send('HISTORY')).toMatch(/No audit yet/);
  });

  it('SET CURRENCY accepts INR and refuses anything else', () => {
    expect(send('SET CURRENCY INR')).toMatch(/INR/);
    expect(send('SET CURRENCY USD')).toMatch(/Only INR/);
  });

  it('DELETE MY DATA erases everything', () => {
    send('electricity 1500');
    const uid = store.pseudonymise(RAW);
    expect(store.expenses.listAll(uid)).toHaveLength(1);
    expect(send('DELETE MY DATA')).toMatch(/erased/);
    expect(store.users.get(uid)).toBeNull();
    expect(store.expenses.listAll(uid)).toHaveLength(0);
  });
});

describe('safety protocol (F-25)', () => {
  it('stops the audit and escalates on a crisis message', () => {
    send('AGREE');
    send('AUDIT');
    const out = send('I want to die, there is no point');
    expect(out).toMatch(/Thank you for telling me/);
    expect(out).toMatch(/14416/);
    expect(out).toMatch(/stop the audit/i);
    // No financial figures in the escalation reply.
    expect(out).not.toMatch(/Tier \d/);
    expect(out).not.toMatch(/FOIR/);
  });

  it('adds harassment guidance when a threat is described', () => {
    send('AGREE');
    const out = send('the recovery agent is threatening me');
    expect(out).toMatch(/screenshots/i);
    expect(out).toMatch(/RBI/);
    expect(out).toMatch(/not legal advice/i);
  });
});

describe('crisis detection helper', () => {
  it('matches clear intent and ignores ordinary money talk', () => {
    expect(M.isCrisisMessage('I want to die')).toBe(true);
    expect(M.isCrisisMessage('killing myself')).toBe(true);
    expect(M.isCrisisMessage('this debt is killing me')).toBe(false);
    expect(M.isCrisisMessage('medicine 400')).toBe(false);
  });
});

describe('parser and router agree on what an expense looks like', () => {
  it('the router logs exactly what the parser returns', () => {
    send('AGREE');
    const parsed = parseExpense('school fees 3000');
    send('school fees 3000');
    const stored = store.expenses.listAll(store.pseudonymise(RAW));
    expect(stored[0].amount).toBe(parsed.amount);
    expect(stored[0].category).toBe(parsed.category);
  });
});
