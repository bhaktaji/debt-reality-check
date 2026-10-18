import { describe, it, expect } from 'vitest';
import { buildReport, reportSections, buildAppendix, toHtmlReport, toTextReport } from '../../core/report.js';
import { diagnoseProfile } from '../../core/profile.js';
import { summariseExpenses, crossCheckCoreCosts, reviewTargets } from '../../core/expense_history.js';
import { ARCHETYPE_BY_ID } from '../fixtures/archetypes.js';

/**
 * Report parity.
 *
 * The on-screen report and the downloaded HTML are the same document. Both are rendered
 * from core/report.js -> reportSections(), so this test asserts that the section list, the
 * narrative and the exact figures all survive the trip into the export.
 */

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

const IDS_IN_ORDER = ['found', 'pressure', 'actions', 'payoff', 'improve', 'numbers', 'spending', 'history', 'checks', 'assumptions', 'appendix'];

describe('one section list drives every renderer', () => {
  it('produces the brief\'s hierarchy, in order', () => {
    const ids = reportSections(reportFor('B')).map((s) => s.id);
    expect(ids).toEqual(IDS_IN_ORDER);
  });

  it('gives every section a unique id and a heading', () => {
    const sections = reportSections(reportFor('B'));
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of sections) expect(s.heading, s.id).toBeTruthy();
  });

  it('never lists a section with no content', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      for (const s of reportSections(reportFor(id))) {
        if (s.kind === 'paragraphs' || s.kind === 'bullets' || s.kind === 'steps' || s.kind === 'cards' || s.kind === 'metrics') {
          expect(s.items.length, `${id}/${s.id}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('the export contains everything the screen shows', () => {
  for (const id of ['A', 'B', 'C', 'D']) {
    it(`Profile ${id}: every section heading appears in the HTML`, () => {
      const report = reportFor(id);
      const html = toHtmlReport(report);
      for (const section of reportSections(report)) {
        expect(html, `${id}/${section.id} heading missing`).toContain(section.heading);
      }
    });

    it(`Profile ${id}: every explained metric value appears in the HTML`, () => {
      const report = reportFor(id);
      const html = toHtmlReport(report);
      for (const metric of report.metricsExplained) {
        expect(html, `${id}/${metric.key} value missing`).toContain(metric.value);
        expect(html, `${id}/${metric.key} label missing`).toContain(metric.plainLabel);
      }
    });

    it(`Profile ${id}: the narrative sentences appear in the HTML and the text report`, () => {
      const report = reportFor(id);
      const html = toHtmlReport(report);
      const text = toTextReport(report);
      expect(html).toContain(report.narrative.plainTier.says);
      expect(text).toContain(report.narrative.plainTier.says);
      for (const line of report.narrative.position) {
        expect(html, `${id}: "${line}"`).toContain(line);
      }
    });
  }
});

describe('the appendix keeps the exact calculated values', () => {
  it('carries the raw metrics, the tier arithmetic and the credit-stress block', () => {
    const report = reportFor('B');
    const html = toHtmlReport(report);
    const appendix = buildAppendix(report);

    for (const [label, value] of [...appendix.tier, ...appendix.raw, ...appendix.creditStress, ...appendix.payoff]) {
      expect(html, `appendix row "${label}"`).toContain(label);
      expect(html, `appendix value "${value}"`).toContain(value);
    }

    // The precise figures the engine produced, not rounded restatements.
    expect(appendix.raw).toContainEqual(['FOIR', '50.0%']);
    expect(appendix.raw).toContainEqual(['Emergency runway', '1.10 months']);
    expect(appendix.tier).toContainEqual(['Tier', '3 of 4 — Critical debt trap']);
  });

  it('matches the diagnostic it was built from', () => {
    const report = reportFor('D');
    const appendix = buildAppendix(report);
    const metrics = report.technical.metrics;
    expect(appendix.raw).toContainEqual(['FOIR', `${metrics.foir.toFixed(1)}%`]);
    expect(appendix.raw).toContainEqual(['Interest burn', `${Math.round(metrics.interestBurn).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).replace('₹', '₹')}/month`]);
    expect(appendix.raw).toContainEqual(['Total debt', `₹${Math.round(metrics.totalBalance).toLocaleString('en-IN')}`]);
  });

  it('lists every glossary term so a reader can look any of them up', () => {
    const appendix = buildAppendix(reportFor('B'));
    expect(appendix.glossary.length).toBeGreaterThan(10);
    for (const entry of appendix.glossary) {
      expect(entry.term).toBeTruthy();
      expect(entry.what).toBeTruthy();
    }
  });

  it('keeps the appendix collapsed in the export so it does not compete with the narrative', () => {
    const html = toHtmlReport(reportFor('B'));
    const detailsAt = html.indexOf('<details>');
    const appendixAt = html.indexOf('Tier assignment');
    expect(detailsAt).toBeGreaterThan(-1);
    expect(appendixAt).toBeGreaterThan(detailsAt);
  });
});

describe('the export is portable', () => {
  it('is one self-contained file with no external assets', () => {
    const html = toHtmlReport(reportFor('C'));
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src="http/i);
    expect(html).toContain('<style>');
  });

  it('is readable on a phone: a viewport, a single column and no fixed widths', () => {
    const html = toHtmlReport(reportFor('C'));
    expect(html).toContain('width=device-width');
    expect(html).toContain('max-width: 44rem');
    expect(html).toContain('@media (min-width: 40rem)');
    // A phone gets one column; two columns only appear from 40rem up.
    expect(html).toMatch(/\.options \{ display: grid; gap: \.75rem; margin: 1rem 0; \}/);
  });

  it('prints cleanly to PDF', () => {
    const html = toHtmlReport(reportFor('C'));
    expect(html).toContain('@media print');
    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('break-after: avoid');
  });
});
