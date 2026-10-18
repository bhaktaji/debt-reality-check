/**
 * web/src/model.js
 * The dashboard's data layer. PURE - no React, no DOM - so it can be unit-tested in Node
 * and compared directly against the bot in the parity test.
 *
 * It imports the SAME core modules as the bot and the CLI. There is no second copy of
 * any financial formula anywhere in this repository (F-03, F-22).
 */

import { buildDiagnosticInput, emptyProfile, emptyDebt, reviewProfile } from '@core/profile.js';
import { runDiagnosticV2 } from '@core/engine_v2.js';
import { summariseExpenses, crossCheckCoreCosts, reviewTargets } from '@core/expense_history.js';
import { buildReport, toHtmlReport, toTextReport } from '@core/report.js';
import { TIER_LABELS } from '@core/policy.js';
import { inr, pct, months as fmtMonths } from '@core/formatting.js';

export { emptyProfile, emptyDebt, TIER_LABELS, inr, pct, fmtMonths };

/** Run the shared diagnostic for a dashboard profile. */
export function diagnose(profile) {
  return runDiagnosticV2(buildDiagnosticInput(profile));
}

/** Plausibility + missing-data questions for the current draft. */
export function review(profile) {
  return reviewProfile(profile);
}

/** Everything the diagnostic panels need, in one object. */
export function buildView(profile, expenses = [], { now = new Date(), history = [] } = {}) {
  const diagnostic = diagnose(profile);
  if (!diagnostic.ok) return { ok: false, message: diagnostic.message, diagnostic };

  const summary = summariseExpenses(expenses, { now, days: 30 });
  const crossCheck = crossCheckCoreCosts(profile.coreExpenses, summary);

  const report = buildReport(diagnostic, {
    generatedAt: new Date(now).toISOString(),
    expenses: { ...summary, ...reviewTargets(summary) },
    expenseCrossCheck: crossCheck,
    history,
  });

  return { ok: true, diagnostic, summary, crossCheck, report };
}

/** Printable HTML audit report, built from the same report model as the bot. */
export function htmlReport(profile, expenses = [], { now = new Date(), history = [] } = {}) {
  const view = buildView(profile, expenses, { now, history });
  if (!view.ok) return null;
  return toHtmlReport(view.report);
}

/** Plain-text report (used for the "copy" action and for parity checks). */
export function textReport(profile, expenses = [], options = {}) {
  const view = buildView(profile, expenses, options);
  if (!view.ok) return null;
  return toTextReport(view.report);
}

/** A compact fingerprint used by the parity test to compare surfaces. */
export function fingerprint(profile) {
  const d = diagnose(profile);
  if (!d.ok) return { ok: false, error: d.error };
  return {
    ok: true,
    tier: d.tier,
    flowTier: d.flowTier,
    tiers: d.tiers,
    drivers: d.drivers,
    foir: Number(d.metrics.foir.toFixed(6)),
    dcfPct: Number(d.metrics.dcfPct.toFixed(6)),
    runway: Number.isFinite(d.metrics.er) ? Number(d.metrics.er.toFixed(6)) : 'inf',
    interestBurn: Math.round(d.metrics.interestBurn),
    cur: d.metrics.cur === null ? null : Number(d.metrics.cur.toFixed(6)),
    unsecuredLines: d.metrics.unsecuredLines,
    avalancheMonths: d.avalanche.months ?? null,
    avalancheInterest: d.avalanche.totalInterest ?? null,
    snowballMonths: d.snowball.months ?? null,
    snowballInterest: d.snowball.totalInterest ?? null,
    feasible: Boolean(d.avalanche.feasible && d.snowball.feasible),
    recommended: d.strategy.pick,
  };
}

export default { diagnose, review, buildView, htmlReport, textReport, fingerprint, emptyProfile, emptyDebt };
