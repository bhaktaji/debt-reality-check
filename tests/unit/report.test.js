import { describe, it, expect } from 'vitest';
import { buildReport, toTextReport, toHtmlReport, toJsonReport, DISCLAIMER } from '../../core/report.js';
import { diagnoseProfile } from '../../core/profile.js';
import { summariseExpenses, crossCheckCoreCosts, reviewTargets } from '../../core/expense_history.js';
import { ARCHETYPE_BY_ID } from '../fixtures/archetypes.js';

const FORBIDDEN = [/\binsolven\w*/i, /\bprohibit\w*/i];

function reportFor(id) {
  const profile = ARCHETYPE_BY_ID[id].profile;
  const diagnostic = diagnoseProfile(profile);
  const expenses = summariseExpenses([], { now: new Date('2026-10-04T12:00:00'), days: 30 });
  return buildReport(diagnostic, {
    profile,
    generatedAt: '2026-10-04T12:00:00.000Z',
    expenses: { ...expenses, ...reviewTargets(expenses) },
    expenseCrossCheck: crossCheckCoreCosts(profile.coreExpenses, expenses),
    history: [{ takenAt: '2026-09-01 10:00:00', tier: 4, tierLabel: 'Acute cash-flow crisis', plainTierName: 'Cash-flow crisis' }],
  });
}

/* ------------------------------------------------------------------ *
 * The conversational layer
 * ------------------------------------------------------------------ */

describe('the report opens with a human explanation, not a wall of metrics', () => {
  it('leads with a plain sentence and a plain-English meaning', () => {
    const r = reportFor('C');
    expect(r.narrative.plainTier.says).toBe("You're in the Critical Debt Trap range.");
    expect(r.narrative.plainTier.means).toMatch(/little room for unexpected problems/i);
    expect(r.narrative.headline).toMatch(/under pressure|path forward/i);
  });

  it("describes the position in the user's own numbers", () => {
    const r = reportFor('C');
    const text = r.narrative.position.join(' ');
    expect(text).toContain('₹1,60,000');
    expect(text).toMatch(/brings? home|bringing home/i);
  });

  it('explains what the numbers mean without naming a formula', () => {
    const r = reportFor('C');
    const plain = [...r.narrative.whatItMeans, ...r.narrative.position].join(' ');
    expect(plain).not.toMatch(/\bFOIR\b/);
    expect(plain).not.toMatch(/\bDCF\b/);
    expect(plain).not.toMatch(/amortis/i);
    expect(plain).not.toMatch(/tier \d/i);
  });

  it('always offers 3 to 5 concrete next actions', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const actions = reportFor(id).narrative.actions;
      expect(actions.length, id).toBeGreaterThanOrEqual(3);
      expect(actions.length, id).toBeLessThanOrEqual(5);
      for (const a of actions) {
        expect(a.title, id).toBeTruthy();
        expect(a.body, id).toBeTruthy();
      }
    }
  });

  it('names the biggest pressure points in plain words', () => {
    const r = reportFor('C');
    expect(r.narrative.pressurePoints.length).toBeGreaterThan(0);
    expect(r.narrative.pressurePoints[0].title).not.toMatch(/FOIR|DCF|runway tier/i);
  });

  it('never uses forbidden language in the narrative', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const text = JSON.stringify(reportFor(id).narrative);
      for (const re of FORBIDDEN) expect(re.test(text), `${id} ${re}`).toBe(false);
    }
  });
});

describe('the payoff section reads as two options, not a strategy table', () => {
  it('names the options in plain English and keeps the technical label secondary', () => {
    const p = reportFor('B').narrative.payoff;
    expect(p.feasible).toBe(true);
    expect(p.optionA.name).toBe('Highest-interest first');
    expect(p.optionA.technical).toBe('Avalanche');
    expect(p.optionB.name).toBe('Smallest balance first');
    expect(p.optionB.technical).toBe('Snowball');
    expect(p.suggestion).toMatch(/^My suggestion:/);
  });

  it('states the rupee difference when the two orders actually differ', () => {
    // The review's own payoff fixture: card 65k at 42%, loan 120k at 16%, BNPL 15k at 30%.
    const profile = {
      netIncome: 60000, rent: 0, coreExpenses: 40000, liquidReserves: 100000,
      debts: [
        { name: 'card', type: 'revolving', secured: false, balance: 65000, minPayment: 3500, apr: 42, creditLimit: 100000 },
        { name: 'loan', type: 'installment', secured: false, balance: 120000, minPayment: 4500, apr: 16 },
        { name: 'bnpl', type: 'bnpl', secured: false, balance: 15000, minPayment: 2000, apr: 30 },
      ],
    };
    const p = buildReport(diagnoseProfile(profile)).narrative.payoff;
    expect(p.feasible).toBe(true);
    expect(p.difference).toBe(543);
    expect(p.differenceText).toContain('₹543');
    expect(p.suggestion).toContain('₹543');
    expect(p.suggestion).toMatch(/highest-interest debt/i);
  });

  it('says plainly when both orders cost the same', () => {
    // Profile B's debts sort identically under both rules, so there is no difference to
    // report and the copy says so rather than inventing one.
    const p = reportFor('B').narrative.payoff;
    expect(p.difference).toBe(0);
    expect(p.differenceText).toMatch(/same here/i);
  });

  it('does not leak engine phrasing into the suggestion', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const p = reportFor(id).narrative.payoff;
      if (!p.feasible) continue;
      expect(p.suggestion).not.toMatch(/behavioural|tier \d|APR-first/i);
    }
  });

  it('explains an infeasible plan instead of inventing a timeline', () => {
    const profile = {
      netIncome: 23500, rent: 0, coreExpenses: 20000, liquidReserves: 0,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 100000, minPayment: 3000, apr: 48, creditLimit: 150000 }],
    };
    const r = buildReport(diagnoseProfile(profile));
    expect(r.narrative.payoff.feasible).toBe(false);
    expect(r.narrative.payoff.intro).toMatch(/no realistic payoff plan/i);
    expect(r.narrative.payoff.detail).toMatch(/short of standing still|interest alone/i);
    expect(r.narrative.payoff.nextStep).toMatch(/lenders/i);
  });
});

describe('explained metrics', () => {
  it('gives every metric a plain label, a value and a meaning', () => {
    const r = reportFor('B');
    expect(r.metricsExplained.length).toBeGreaterThanOrEqual(6);
    for (const metric of r.metricsExplained) {
      expect(metric.plainLabel, metric.key).toBeTruthy();
      expect(metric.technicalLabel, metric.key).toBeTruthy();
      expect(metric.value, metric.key).toBeTruthy();
      if (metric.available) expect(metric.meaning, metric.key).toBeTruthy();
    }
  });

  it('translates FOIR into rupees per hundred', () => {
    const foir = reportFor('B').metricsExplained.find((m) => m.key === 'foir');
    expect(foir.value).toBe('50.0%');
    expect(foir.meaning).toMatch(/₹50 of every ₹100/);
  });

  it('explains an unknown credit limit instead of guessing one', () => {
    const profile = {
      netIncome: 100000, rent: 0, coreExpenses: 20000, liquidReserves: 500000,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 65000, minPayment: 5000, apr: 42 }],
    };
    const metric = buildReport(diagnoseProfile(profile)).metricsExplained.find((m) => m.key === 'creditUtilisation');
    expect(metric.available).toBe(false);
    expect(metric.value).toBe('Unknown');
    expect(metric.why).toMatch(/did not provide a credit limit/i);
  });
});

/* ------------------------------------------------------------------ *
 * Text renderer
 * ------------------------------------------------------------------ */

describe('text report', () => {
  it('leads with the narrative and keeps the exact figures in the appendix', () => {
    const text = toTextReport(reportFor('B'));
    expect(text).toContain('YOUR DEBT REALITY CHECK');
    expect(text).toContain("You're in the Critical Debt Trap range.");
    expect(text).toContain('WHAT I WOULD FOCUS ON NEXT');
    expect(text).toContain('YOUR NUMBERS');
    expect(text).toContain('TECHNICAL DETAIL');
    expect(text).toContain(DISCLAIMER);

    // The appendix still carries the exact calculated values.
    expect(text).toContain('Tier 3 of 4');
    expect(text).toContain('Critical debt trap');
    expect(text).toContain('FOIR 50.0%');
    expect(text).toContain('Runway 1.10 months');
  });

  it('warns when the payoff plan is infeasible instead of inventing a timeline', () => {
    const profile = {
      netIncome: 23500, rent: 0, coreExpenses: 20000, liquidReserves: 0,
      debts: [{ name: 'card', type: 'revolving', secured: false, balance: 100000, minPayment: 3000, apr: 48, creditLimit: 150000 }],
    };
    const text = toTextReport(buildReport(diagnoseProfile(profile)));
    expect(text).toMatch(/no realistic payoff plan/i);
    expect(text).not.toMatch(/360\+/);
  });

  it('never uses forbidden language', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const text = toTextReport(reportFor(id));
      for (const re of FORBIDDEN) expect(re.test(text), `${id} ${re}`).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * HTML renderer
 * ------------------------------------------------------------------ */

describe('HTML report', () => {
  it('is a complete, self-contained, printable, localised document', () => {
    const html = toHtmlReport(reportFor('C'));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('lang="en-IN"');
    expect(html).toContain('viewport');
    expect(html).toContain('@media print');
    expect(html).toContain('</html>');
    expect(html).toContain(DISCLAIMER);
    // No external assets: it must work offline from a single file.
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script/i);
  });

  it('reads as a consultation, with the technical appendix collapsed', () => {
    const html = toHtmlReport(reportFor('B'));
    expect(html).toContain("Here's what I found");
    expect(html).toContain('What I would focus on next');
    expect(html).toContain('Your debt payoff plan');
    expect(html).toContain('Your numbers');
    expect(html).toContain('Assumptions and limitations');
    expect(html).toContain('<details>');
    expect(html).toContain('Show the full calculation details');
  });

  it('keeps the exact calculated values in the appendix', () => {
    const html = toHtmlReport(reportFor('B'));
    expect(html).toContain('50.0%');
    expect(html).toContain('1.10 months');
    expect(html).toContain('Critical debt trap');
    expect(html).toContain('Credit-stress indicators');
    expect(html).toContain('Avalanche');
    expect(html).toContain('Snowball');
  });

  it('shows the tier-4 label and never the legal term', () => {
    const html = toHtmlReport(reportFor('A'));
    expect(html).toContain('Cash-flow crisis');
    expect(html).toContain('Acute cash-flow crisis');
    expect(html).not.toMatch(/insolven/i);
  });

  it('includes the audit history when it is supplied', () => {
    expect(toHtmlReport(reportFor('B'))).toContain('Your audit history');
  });

  it('escapes HTML in user-derived text', () => {
    // A debt whose minimum does not cover its interest: its name is echoed into a note,
    // which is exactly the path that must be escaped.
    const profile = {
      netIncome: 200000, rent: 0, coreExpenses: 40000, liquidReserves: 500000,
      debts: [{ name: '<script>alert(1)</script>', type: 'revolving', secured: false, balance: 200000, minPayment: 2000, apr: 36, creditLimit: 400000 }],
    };
    const html = toHtmlReport(buildReport(diagnoseProfile(profile)));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never uses forbidden language', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const html = toHtmlReport(reportFor(id));
      for (const re of FORBIDDEN) expect(re.test(html), `${id} ${re}`).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * JSON renderer
 * ------------------------------------------------------------------ */

describe('JSON report', () => {
  it('round-trips through JSON', () => {
    const json = toJsonReport(reportFor('D'));
    expect(json.tier).toBe(4);
    expect(JSON.parse(JSON.stringify(json)).metrics.foir).toBeCloseTo(109.1, 1);
    expect(json.narrative.plainTier.name).toBe('Cash-flow crisis');
  });
});
