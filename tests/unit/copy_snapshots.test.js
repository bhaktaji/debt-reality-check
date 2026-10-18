import { describe, it, expect } from 'vitest';
import * as M from '../../bot/messages.js';
import { DIRECTIVES, TIER_LABELS, TIER_STATUS, CAREER_RISK } from '../../core/policy.js';
import {
  PLAIN_TIER, HEADLINES, GLOSSARY, ACTIONS_BY_TIER, RECOMMENDATION_BY_TIER, DEBT_TYPE_CHOICES,
} from '../../core/plain_language.js';
import { DISCLAIMER } from '../../core/report.js';
import { buildNarrative } from '../../core/narrative.js';
import { diagnoseProfile } from '../../core/profile.js';
import { ARCHETYPES } from '../fixtures/archetypes.js';

/**
 * Copy guardrails (F-25).
 *
 * The words "insolvent" and "prohibited" must never reach a user. Absolute labels
 * delivered with no distress protocol can harm the people this product targets, so the
 * ban is enforced by test rather than by review.
 */

const FORBIDDEN = [/\binsolven\w*/i, /\bprohibit\w*/i, /\bmandated\b/i, /\bstrictly\s+required\b/i];

function allStrings() {
  const out = [];
  const walk = (value, path) => {
    if (typeof value === 'string') out.push([path, value]);
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    }
  };
  walk(M, 'M');
  walk(DIRECTIVES, 'DIRECTIVES');
  walk(TIER_LABELS, 'TIER_LABELS');
  walk(TIER_STATUS, 'TIER_STATUS');
  walk(CAREER_RISK, 'CAREER_RISK');
  walk(PLAIN_TIER, 'PLAIN_TIER');
  walk(HEADLINES, 'HEADLINES');
  walk(GLOSSARY, 'GLOSSARY');
  walk(ACTIONS_BY_TIER, 'ACTIONS_BY_TIER');
  walk(RECOMMENDATION_BY_TIER, 'RECOMMENDATION_BY_TIER');
  walk(DEBT_TYPE_CHOICES, 'DEBT_TYPE_CHOICES');
  out.push(['DISCLAIMER', DISCLAIMER]);
  return out;
}

describe('forbidden language', () => {
  it('never appears in any message, label or directive', () => {
    for (const [path, text] of allStrings()) {
      for (const re of FORBIDDEN) {
        expect(re.test(text), `${path} matched ${re} in: ${text}`).toBe(false);
      }
    }
  });

  it('does not appear in rendered template output either', () => {
    const rendered = [
      M.EXPENSE_LOGGED('₹400', 'Health', true),
      M.EXPENSE_CONFIRM('₹30', 'eggs'),
      M.SET_CURRENCY_ACK('INR'),
      M.CRISIS_REPLY,
      M.HARASSMENT_GUIDANCE,
      M.FIRST_CONTACT,
      M.HELP,
      ...Object.values(M.AUDIT_QUESTIONS),
    ].join('\n');
    for (const re of FORBIDDEN) expect(re.test(rendered), String(re)).toBe(false);
  });

  it('does not appear in the narrative for any archetype', () => {
    for (const a of ARCHETYPES) {
      const narrative = buildNarrative(diagnoseProfile(a.profile), { profile: a.profile });
      const text = JSON.stringify(narrative);
      for (const re of FORBIDDEN) {
        expect(re.test(text), `Profile ${a.id} matched ${re}`).toBe(false);
      }
    }
  });
});

describe('stable templates', () => {
  it('first contact states the retention window and the erase command', () => {
    expect(M.FIRST_CONTACT).toContain('90 days');
    expect(M.FIRST_CONTACT).toContain('DELETE MY DATA');
    expect(M.FIRST_CONTACT).toContain('one-way hash');
    expect(M.FIRST_CONTACT).toContain('AGREE');
  });

  it('help lists every required command', () => {
    for (const cmd of ['AUDIT', 'SUMMARY', 'CANCEL', 'BACK', 'DELETE MY DATA', 'HELP', 'SET CURRENCY']) {
      expect(M.HELP, cmd).toContain(cmd);
    }
  });

  it('the crisis reply names a helpline and stops the flow', () => {
    expect(M.CRISIS_REPLY).toMatch(/14416/);
    expect(M.CRISIS_REPLY).toMatch(/stop the audit/i);
    expect(M.CRISIS_REPLY).toMatch(/trust/i);
  });

  it('harassment guidance points at official routes and hedges legal advice', () => {
    expect(M.HARASSMENT_GUIDANCE).toMatch(/screenshots/i);
    expect(M.HARASSMENT_GUIDANCE).toMatch(/RBI/);
    expect(M.HARASSMENT_GUIDANCE).toMatch(/not legal advice/i);
  });

  it('the expense confirmation always restates the amount', () => {
    expect(M.EXPENSE_CONFIRM('₹30', 'eggs')).toBe('I read that as ₹30 for "eggs". Reply YES to log it, or send it again with the correct amount.');
  });

  it('the expense log line names the category and the classification', () => {
    expect(M.EXPENSE_LOGGED('₹400', 'Health', true)).toBe('Logged ₹400 - Health (essential).');
    expect(M.EXPENSE_LOGGED('₹40', 'Uncategorised', false)).toBe('Logged ₹40 - Uncategorised (discretionary).');
    expect(M.EXPENSE_LOGGED('₹40', 'Uncategorised', null)).toBe('Logged ₹40 - Uncategorised (uncategorised).');
  });

  it('every tier has a label, a status and directives', () => {
    for (const tier of [1, 2, 3, 4]) {
      expect(TIER_LABELS[tier]).toBeTruthy();
      expect(TIER_STATUS[tier]).toBeTruthy();
      expect(DIRECTIVES[tier].borrowing).toBeTruthy();
      expect(DIRECTIVES[tier].career).toBeTruthy();
      expect(DIRECTIVES[tier].next30).toBeTruthy();
    }
    expect(TIER_LABELS[4]).toBe('Acute cash-flow crisis');
  });
});
