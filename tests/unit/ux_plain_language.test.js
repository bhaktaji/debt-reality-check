import { describe, it, expect } from 'vitest';
import {
  PLAIN_TIER, HEADLINES, GLOSSARY, gloss, glossaryList,
  ACTIONS_BY_TIER, RECOMMENDATION_BY_TIER, DEBT_TYPE_CHOICES, engineTypeForChoice, choiceForEngineType,
} from '../../core/plain_language.js';
import { buildNarrative } from '../../core/narrative.js';
import { explainedMetrics } from '../../core/explain.js';
import { diagnoseProfile } from '../../core/profile.js';
import { ARCHETYPES } from '../fixtures/archetypes.js';

/**
 * The plain-language contract.
 *
 * A person who has never heard of FOIR, DCF, APR or amortisation must be able to read the
 * whole result without meeting one of those words. These tests enforce that, and enforce
 * that the technical vocabulary still exists where it belongs.
 */

const FORBIDDEN = [/\binsolven\w*/i, /\bprohibit\w*/i, /\bmandated\b/i];

/** Words that must never appear in the primary reading flow. */
const JARGON = [
  /\bFOIR\b/, /\bDCF\b/, /\bDASI\b/, /\bAPR\b/, /amortis/i, /\bDTI\b/,
  /interest burn/i, /dependency load/i, /centimonth/i, /basis point/i,
  /\btier \d\b/i, /negative amortisation/i,
];

describe('the glossary behind every tooltip', () => {
  it('covers every technical term the product exposes', () => {
    for (const key of ['foir', 'dcf', 'runway', 'creditUtilisation', 'apr', 'trueApr', 'avalanche', 'snowball', 'minimumPayment', 'essentials', 'reserves', 'secured', 'revolving', 'bnpl', 'loanApp', 'tier']) {
      const entry = gloss(key);
      expect(entry.what, key).toBeTruthy();
      expect(entry.plain, key).toBeTruthy();
      expect(entry.term, key).toBeTruthy();
    }
  });

  it('explains terms in plain sentences, not textbook definitions', () => {
    for (const entry of glossaryList()) {
      expect(entry.what.length, entry.key).toBeGreaterThan(40);
      expect(entry.what.length, entry.key).toBeLessThan(260);
      // A definition should read as a sentence, not a formula.
      expect(entry.what, entry.key).not.toMatch(/[=×÷∑]|,\s*where\b/i);
      expect(entry.what.trim().endsWith('.'), entry.key).toBe(true);
    }
  });

  it('has a fallback so a missing key never breaks a view', () => {
    expect(gloss('not-a-real-key').what).toBe('');
  });

  it('never uses forbidden language', () => {
    for (const re of FORBIDDEN) {
      expect(re.test(JSON.stringify(GLOSSARY)), String(re)).toBe(false);
    }
  });
});

describe('the tiers, in plain English', () => {
  it('gives every tier a plain name, an opening sentence, a meaning and a headline', () => {
    for (const tier of [1, 2, 3, 4]) {
      expect(PLAIN_TIER[tier].name, String(tier)).toBeTruthy();
      expect(PLAIN_TIER[tier].says, String(tier)).toMatch(/^You're in /);
      expect(PLAIN_TIER[tier].means, String(tier)).toBeTruthy();
      expect(HEADLINES[tier], String(tier)).toBeTruthy();
      expect(RECOMMENDATION_BY_TIER[tier], String(tier)).toBeTruthy();
    }
  });

  it('describes tier 3 exactly as the brief asks', () => {
    expect(PLAIN_TIER[3].says).toBe("You're in the Critical Debt Trap range.");
    expect(PLAIN_TIER[3].means).toMatch(/little room for unexpected problems/i);
  });

  it('offers three to five short actions per tier', () => {
    for (const tier of [1, 2, 3, 4]) {
      const actions = ACTIONS_BY_TIER[tier];
      expect(actions.length, String(tier)).toBeGreaterThanOrEqual(3);
      expect(actions.length, String(tier)).toBeLessThanOrEqual(5);
      for (const a of actions) {
        expect(a.title.length, a.title).toBeLessThan(60);
        expect(a.body.length, a.title).toBeLessThan(240);
      }
    }
  });

  it('never uses forbidden language in any tier copy', () => {
    const all = JSON.stringify({ PLAIN_TIER, HEADLINES, ACTIONS_BY_TIER, RECOMMENDATION_BY_TIER });
    for (const re of FORBIDDEN) expect(re.test(all), String(re)).toBe(false);
  });
});

describe('friendly debt types', () => {
  it('offers the choices a person would recognise', () => {
    const labels = DEBT_TYPE_CHOICES.map((c) => c.label);
    for (const expected of ['Credit card', 'Personal loan', 'Buy now, pay later', 'Loan app', 'Vehicle loan', 'Something else']) {
      expect(labels).toContain(expected);
    }
  });

  it('maps each choice onto the engine vocabulary', () => {
    expect(engineTypeForChoice('credit_card')).toBe('revolving');
    expect(engineTypeForChoice('personal_loan')).toBe('installment');
    expect(engineTypeForChoice('bnpl')).toBe('bnpl');
    expect(engineTypeForChoice('loan_app')).toBe('loanapp');
    expect(engineTypeForChoice('vehicle_loan')).toBe('installment');
    // An unknown choice never crashes and never invents a revolving line.
    expect(engineTypeForChoice('mystery')).toBe('installment');
  });

  it('round-trips an engine type back to a friendly choice', () => {
    for (const c of DEBT_TYPE_CHOICES) {
      expect(engineTypeForChoice(choiceForEngineType(c.type))).toBe(c.type);
    }
  });
});

describe('the narrative a beginner actually reads', () => {
  for (const a of ARCHETYPES) {
    it(`Profile ${a.id} contains no jargon in the reading flow`, () => {
      const diagnostic = diagnoseProfile(a.profile);
      const n = buildNarrative(diagnostic, { profile: a.profile });

      const plain = [
        n.plainTier.says, n.plainTier.means, n.headline, n.recommendation,
        ...n.position, ...n.whatItMeans,
        ...n.pressurePoints.flatMap((p) => [p.title, p.body]),
        ...n.actions.flatMap((x) => [x.title, x.body]),
        ...n.improvement.sentences,
        ...n.assumptions,
        n.payoff.feasible ? `${n.payoff.intro} ${n.payoff.differenceText} ${n.payoff.suggestion}` : `${n.payoff.intro} ${n.payoff.detail} ${n.payoff.nextStep}`,
      ].join('\n');

      for (const re of JARGON) {
        expect(re.test(plain), `Profile ${a.id} leaked ${re} into the reading flow`).toBe(false);
      }
    });
  }

  it('keeps the technical names available for anyone who wants them', () => {
    const diagnostic = diagnoseProfile(ARCHETYPES[1].profile);
    const metrics = explainedMetrics(diagnostic);
    const technical = metrics.map((m) => m.technicalLabel).join(' ');
    expect(technical).toMatch(/FOIR/);
    expect(technical).toMatch(/DCF/);
    expect(technical).toMatch(/runway/i);
    expect(technical).toMatch(/[Cc]redit utilisation/);
  });

  it('explains every number it shows', () => {
    for (const a of ARCHETYPES) {
      for (const metric of explainedMetrics(diagnoseProfile(a.profile))) {
        if (metric.available) {
          expect(metric.meaning, `${a.id}/${metric.key}`).toBeTruthy();
          expect(metric.meaning.length, `${a.id}/${metric.key}`).toBeGreaterThan(30);
        } else {
          expect(metric.why, `${a.id}/${metric.key}`).toBeTruthy();
        }
      }
    }
  });
});
