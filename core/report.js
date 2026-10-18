/**
 * core/report.js
 * ONE report model, one section list, three renderers.
 *
 *   buildReport()     -> the model (narrative + explained numbers + technical appendix)
 *   reportSections()  -> the ordered section list the on-screen report AND the HTML export
 *                        both render. This is what guarantees they cannot drift apart.
 *   toTextReport()    -> chat / clipboard
 *   toHtmlReport()    -> a single self-contained file for printing or saving as PDF
 *   toJsonReport()    -> storage and trend analysis
 *
 * Layout order is deliberate: a person reads the narrative, and the formulas sit in an
 * appendix they have to open on purpose.
 *
 * Pure. No I/O.
 */

import { buildNarrative } from './narrative.js';
import { explainedMetrics } from './explain.js';
import { gloss, glossaryList, PLAIN_TIER } from './plain_language.js';
import { inr, pct, months as fmtMonths } from './formatting.js';

export const DISCLAIMER =
  'Informational only. This is not legal, tax or investment advice. A qualified professional should review your individual circumstances.';

export { PLAIN_TIER };

/** Build the report model. */
export function buildReport(diagnostic, extras = {}) {
  const { expenses = null, expenseCrossCheck = null, history = [] } = extras;

  return {
    // ---- preserved engine output (appendix, and the contract tests rely on it) --------
    ...diagnostic,

    // ---- the conversational layer -----------------------------------------------------
    generatedAt: extras.generatedAt ?? null,
    disclaimer: DISCLAIMER,
    narrative: buildNarrative(diagnostic, { profile: extras.profile }),
    metricsExplained: explainedMetrics(diagnostic),

    // ---- supporting blocks ------------------------------------------------------------
    expenses,
    expenseCrossCheck,
    history,

    // ---- the technical appendix -------------------------------------------------------
    technical: {
      tier: diagnostic.tier,
      tierLabel: diagnostic.tierLabel,
      plainTierName: PLAIN_TIER[diagnostic.tier]?.name ?? diagnostic.tierLabel,
      flowTier: diagnostic.flowTier,
      tiers: diagnostic.tiers,
      drivers: diagnostic.drivers,
      explanation: diagnostic.explanation,
      notes: diagnostic.notes,
      metrics: diagnostic.metrics,
      creditStress: diagnostic.creditStress,
      career: diagnostic.career,
      distance: diagnostic.distance,
      budget: diagnostic.budget,
      warnings: diagnostic.warnings,
      questions: diagnostic.questions,
      directives: diagnostic.directives,
    },
    glossary: glossaryList(),
  };
}

/* ------------------------------------------------------------------ *
 * The shared section list
 * ------------------------------------------------------------------ */

/**
 * The report as an ordered list of sections, described with plain data (no markup).
 * Both the React view and the HTML export walk this list, so the on-screen report and
 * the downloaded report are the same document by construction.
 */
export function reportSections(report) {
  const n = report.narrative;
  const sections = [];

  sections.push({
    id: 'found',
    heading: "Here's what I found",
    kind: 'paragraphs',
    items: [...n.position, ...n.whatItMeans],
  });

  if (n.pressurePoints.length) {
    sections.push({ id: 'pressure', heading: 'Your biggest pressure points', kind: 'cards', items: n.pressurePoints });
  }

  sections.push({ id: 'actions', heading: 'What I would focus on next', kind: 'steps', items: n.actions });
  sections.push({ id: 'payoff', heading: 'Your debt payoff plan', kind: 'payoff', payoff: n.payoff });

  if (n.improvement.applicable) {
    sections.push({ id: 'improve', heading: 'How things could improve', kind: 'bullets', items: n.improvement.sentences });
  }

  sections.push({
    id: 'numbers',
    heading: 'Your numbers',
    kind: 'metrics',
    intro: 'Each figure below is followed by what it actually means for you.',
    items: report.metricsExplained,
  });

  if (report.expenses) {
    sections.push({
      id: 'spending',
      heading: 'Your spending',
      kind: 'spending',
      expenses: report.expenses,
      crossCheck: report.expenseCrossCheck,
    });
  }

  if (report.history?.length) {
    sections.push({ id: 'history', heading: 'Your audit history', kind: 'history', items: report.history });
  }

  if (n.checks.length) {
    sections.push({ id: 'checks', heading: 'Things worth checking', kind: 'bullets', items: n.checks });
  }

  sections.push({ id: 'assumptions', heading: 'Assumptions and limitations', kind: 'bullets', items: n.assumptions });
  sections.push({ id: 'appendix', heading: 'Calculation details', kind: 'appendix', appendix: buildAppendix(report) });

  return sections;
}

/** The technical appendix, as label/value pairs so any renderer can print it. */
export function buildAppendix(report) {
  const t = report.technical;
  const m = t.metrics;
  const money = (v) => inr(v);

  return {
    tier: [
      ['Tier', `${t.tier} of 4 — ${t.tierLabel}`],
      ['Flow tier (before the buffer adjustment)', String(t.flowTier)],
      ['FOIR tier / DCF tier / runway tier', `${t.tiers.foir} / ${t.tiers.dcf} / ${t.tiers.runway}`],
      ['Drivers', (t.drivers ?? []).join(', ') || 'combined metrics'],
    ],
    raw: [
      ['Effective monthly income', money(m.incomeEff)],
      ['Mandatory payments (minimums + rent)', money(m.mandatory)],
      ['Total monthly outflow', money(m.outflow)],
      ['FOIR', pct(m.foir)],
      ['DCF', `${money(m.dcf)} (${pct(m.dcfPct)})`],
      ['Emergency runway', Number.isFinite(m.er) ? fmtMonths(m.er) : 'not applicable'],
      ['Interest burn', `${money(m.interestBurn)}/month`],
      ['Debt-to-income', `${m.dtiMonths.toFixed(2)} months`],
      ['Total debt', money(m.totalBalance)],
      ['Months to default', Number.isFinite(m.monthsToDefault) ? m.monthsToDefault.toFixed(2) : 'not applicable'],
      ['Monthly debt-service budget', money(t.budget ?? 0)],
    ],
    creditStress: [
      ['Utilisation', t.creditStress.utilisation === null ? 'unknown' : pct(t.creditStress.utilisation)],
      ['Utilisation band', t.creditStress.utilisationStatus],
      ['Unsecured lines with a balance', String(t.creditStress.unsecuredLines)],
      ['Secured lines with a balance', String(t.creditStress.securedLines)],
      ['Three or more unsecured lines', t.creditStress.stackingFlag ? 'yes' : 'no'],
    ],
    creditStressNote: t.creditStress.note,
    payoff: [
      [
        'Avalanche (highest interest first)',
        report.avalanche.feasible
          ? `${report.avalanche.months} months, ${money(report.avalanche.totalInterest)} interest`
          : `infeasible (${report.avalanche.reason})`,
      ],
      [
        'Snowball (smallest balance first)',
        report.snowball.feasible
          ? `${report.snowball.months} months, ${money(report.snowball.totalInterest)} interest`
          : `infeasible (${report.snowball.reason})`,
      ],
      ['Recommended', report.strategy.pick],
    ],
    explanation: t.explanation ?? [],
    notes: t.notes ?? [],
    warnings: (t.warnings ?? []).map((w) => w.message),
    questions: (t.questions ?? []).map((q) => q.message),
    glossary: report.glossary,
  };
}

/* ------------------------------------------------------------------ *
 * Text renderer (chat / clipboard)
 * ------------------------------------------------------------------ */

export function toTextReport(report) {
  const n = report.narrative;
  const m = report.metrics;
  const lines = [];

  lines.push('YOUR DEBT REALITY CHECK');
  lines.push('');
  lines.push(n.plainTier.says);
  lines.push(n.headline);
  lines.push('');
  lines.push(`In plain English: ${n.plainTier.means}`);
  lines.push('');

  lines.push("HERE'S THE SITUATION");
  for (const s of n.position) lines.push(`- ${s}`);
  lines.push('');

  lines.push('WHAT THIS MEANS');
  for (const s of n.whatItMeans) lines.push(`- ${s}`);
  lines.push('');

  if (n.pressurePoints.length) {
    lines.push('YOUR BIGGEST PRESSURE POINTS');
    for (const p of n.pressurePoints) lines.push(`- ${p.title}: ${p.body}`);
    lines.push('');
  }

  lines.push('WHAT I WOULD FOCUS ON NEXT');
  n.actions.forEach((a, i) => lines.push(`${i + 1}. ${a.title} - ${a.body}`));
  lines.push('');

  lines.push('YOUR DEBT PAYOFF PLAN');
  if (n.payoff.feasible) {
    lines.push(`- ${n.payoff.intro}`);
    lines.push(`- Option 1, ${n.payoff.optionA.name}: ${n.payoff.optionA.text}`);
    lines.push(`- Option 2, ${n.payoff.optionB.name}: ${n.payoff.optionB.text}`);
    lines.push(`- ${n.payoff.differenceText}`);
    lines.push(`- ${n.payoff.suggestion}`);
  } else {
    lines.push(`- ${n.payoff.intro}`);
    lines.push(`- ${n.payoff.detail}`);
    lines.push(`- ${n.payoff.nextStep}`);
  }
  lines.push('');

  if (n.improvement.applicable) {
    lines.push('HOW THINGS COULD IMPROVE');
    for (const s of n.improvement.sentences) lines.push(`- ${s}`);
    lines.push('');
  }

  lines.push('YOUR NUMBERS');
  for (const metric of report.metricsExplained) {
    lines.push(`- ${metric.plainLabel}: ${metric.value}`);
    if (metric.available && metric.meaning) lines.push(`  ${metric.meaning}`);
    if (!metric.available && metric.why) lines.push(`  ${metric.why}`);
  }
  lines.push('');

  if (report.expenses) {
    const e = report.expenses;
    lines.push('YOUR SPENDING');
    lines.push(`- Today: ${inr(e.today.total)} across ${e.today.count} entries`);
    lines.push(`- Last ${e.windowDays} days: ${inr(e.last30.total)}`);
    lines.push(`- Essential ${inr(e.essential.total)} | Discretionary ${inr(e.discretionary.total)} | Uncategorised ${inr(e.uncategorised.total)}`);
    lines.push('');
  }

  if (n.checks.length) {
    lines.push('CHECK THESE');
    for (const c of n.checks) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push('ASSUMPTIONS AND LIMITATIONS');
  for (const a of n.assumptions) lines.push(`- ${a}`);
  lines.push('');

  lines.push('TECHNICAL DETAIL');
  lines.push(`- Tier ${report.tier} of 4 (${report.tierLabel}); flow tier ${report.flowTier}`);
  lines.push(`- FOIR ${pct(m.foir)} | DCF ${inr(m.dcf)} (${pct(m.dcfPct)}) | Runway ${fmtMonths(m.er)}`);
  lines.push(`- Interest burn ${inr(m.interestBurn)}/month | Debt ${inr(m.totalBalance)}`);
  lines.push(`- Credit utilisation ${m.cur === null ? 'unknown' : pct(m.cur)} | Unsecured lines ${m.unsecuredLines}`);
  for (const line of report.explanation ?? []) lines.push(`- ${line}`);
  for (const note of report.notes ?? []) lines.push(`- ${note}`);
  lines.push('');

  lines.push(DISCLAIMER);
  return lines.join('\n');
}

/** JSON-serialisable report for storage / trend analysis. */
export function toJsonReport(report) {
  return JSON.parse(JSON.stringify(report));
}

/* ------------------------------------------------------------------ *
 * HTML renderer - a single self-contained file
 * ------------------------------------------------------------------ */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bullets(list) {
  return `<ul>${(list ?? []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
}

function kvTable(rows) {
  return `<table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}

function payoffHtml(p) {
  if (!p.feasible) {
    return `<p>${esc(p.intro)}</p><p>${esc(p.detail)}</p><p class="callout">${esc(p.nextStep)}</p>`;
  }
  return `
    <p>${esc(p.intro)}</p>
    <div class="options">
      <div class="option${p.optionA.recommended ? ' option-recommended' : ''}">
        <h4>Option 1: ${esc(p.optionA.name)}${p.optionA.recommended ? ' <span class="tag">Suggested</span>' : ''}</h4>
        <p>${esc(p.optionA.text)}</p>
        <p class="tiny">Also called ${esc(p.optionA.technical)}.</p>
      </div>
      <div class="option${p.optionB.recommended ? ' option-recommended' : ''}">
        <h4>Option 2: ${esc(p.optionB.name)}${p.optionB.recommended ? ' <span class="tag">Suggested</span>' : ''}</h4>
        <p>${esc(p.optionB.text)}</p>
        <p class="tiny">Also called ${esc(p.optionB.technical)}.</p>
      </div>
    </div>
    <p class="callout">${esc(p.differenceText)}</p>
    <p>${esc(p.suggestion)}</p>`;
}

function sectionHtml(section) {
  switch (section.kind) {
    case 'paragraphs':
      return section.items.map((p) => `<p>${esc(p)}</p>`).join('');
    case 'cards':
      return section.items.map((p) => `<div class="card"><h4>${esc(p.title)}</h4><p>${esc(p.body)}</p></div>`).join('');
    case 'steps':
      return `<ol class="actions">${section.items.map((a) => `<li><strong>${esc(a.title)}</strong><span>${esc(a.body)}</span></li>`).join('')}</ol>`;
    case 'bullets':
      return bullets(section.items);
    case 'payoff':
      return payoffHtml(section.payoff);
    case 'metrics':
      return `${section.intro ? `<p class="tiny">${esc(section.intro)}</p>` : ''}${section.items
        .map((metric) => `
        <div class="metric${metric.available ? '' : ' metric-unknown'}">
          <div class="metric-head">
            <span class="metric-label">${esc(metric.plainLabel)}</span>
            <span class="metric-value">${esc(metric.value)}</span>
          </div>
          <p class="metric-meaning">${esc(metric.available ? metric.meaning : metric.why)}</p>
          <p class="metric-technical">${esc(metric.technicalLabel)}</p>
        </div>`)
        .join('')}`;
    case 'spending': {
      const e = section.expenses;
      return `
        <p>In the last ${esc(e.windowDays)} days you logged ${esc(inr(e.last30.total))} across ${esc(e.last30.count)} entries. Today: ${esc(inr(e.today.total))}.</p>
        <p>Essential ${esc(inr(e.essential.total))} &middot; Discretionary ${esc(inr(e.discretionary.total))} &middot; Uncategorised ${esc(inr(e.uncategorised.total))}.</p>
        <p class="tiny">Essential spending is not a cut target.</p>
        ${section.crossCheck ? `<p>${esc(section.crossCheck.message)}</p>` : ''}`;
    }
    case 'history':
      return `<table>
        <caption class="sr-only">Previous audits and how your position moved</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Position</th><th scope="col">Tier</th></tr></thead>
        <tbody>${section.items
          .map((h) => `<tr><td>${esc(h.takenAt)}</td><td>${esc(h.plainTierName ?? h.tierLabel ?? '')}</td><td>${esc(h.tier)} of 4</td></tr>`)
          .join('')}</tbody>
      </table>`;
    case 'appendix': {
      const a = section.appendix;
      return `
        <h3>Tier assignment</h3>
        ${kvTable(a.tier)}
        ${bullets(a.explanation)}
        ${bullets(a.notes)}
        <h3>Raw metrics</h3>
        ${kvTable(a.raw)}
        <h3>Credit-stress indicators</h3>
        <p class="tiny">${esc(a.creditStressNote)}</p>
        ${kvTable(a.creditStress)}
        <h3>Payoff simulation</h3>
        ${kvTable(a.payoff)}
        ${a.warnings.length ? `<h3>Data checks</h3>${bullets(a.warnings)}` : ''}
        ${a.questions.length ? `<h3>Not provided</h3>${bullets(a.questions)}` : ''}
        <h3>What the terms mean</h3>
        <dl class="glossary">${a.glossary.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.what)}</dd>`).join('')}</dl>`;
    }
    default:
      return '';
  }
}

/** A single self-contained HTML file. No external assets, so it works offline. */
export function toHtmlReport(report, title = 'Your Debt Reality Check') {
  const n = report.narrative;
  const generated = report.generatedAt ? new Date(report.generatedAt).toLocaleString('en-IN') : '';
  const sections = reportSections(report);

  const body = sections
    .map((s) => {
      const inner = sectionHtml(s);
      if (s.kind === 'appendix') {
        return `<h2>${esc(s.heading)}</h2>
<details>
  <summary>Show the full calculation details</summary>
  ${inner}
</details>`;
      }
      return `<h2>${esc(s.heading)}</h2>\n${inner}`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; max-width: 44rem; padding: 2rem 1.25rem 4rem;
    font: 17px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1b2530; background: #fff;
  }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 .25rem; letter-spacing: -.01em; }
  h2 { font-size: 1.2rem; margin: 2.5rem 0 .75rem; padding-bottom: .4rem; border-bottom: 1px solid #e3e9f0; }
  h3 { font-size: 1rem; margin: 1.75rem 0 .5rem; }
  h4 { font-size: .98rem; margin: 0 0 .4rem; }
  p { margin: .6rem 0; }
  ul { margin: .6rem 0; padding-left: 1.25rem; }
  li { margin: .35rem 0; }
  .sub { color: #5d6b7a; font-size: .9rem; margin: 0 0 2rem; }
  .verdict { border-left: 6px solid #6b7c90; background: #f7f9fb; border-radius: 0 10px 10px 0; padding: 1.25rem 1.4rem; margin: 1.5rem 0 0; }
  .verdict.tier1 { border-left-color: #1a7f4b; background: #f2faf5; }
  .verdict.tier2 { border-left-color: #8a6100; background: #fffaf0; }
  .verdict.tier3 { border-left-color: #a9501b; background: #fff6f1; }
  .verdict.tier4 { border-left-color: #a01818; background: #fdf2f2; }
  .verdict .says { font-size: 1.35rem; font-weight: 700; margin: 0 0 .35rem; }
  .verdict .headline { font-size: 1.05rem; margin: 0; }
  .verdict .means { margin: .8rem 0 0; }
  .tiernote { color: #5d6b7a; font-size: .85rem; margin: .8rem 0 0; }
  .card { border: 1px solid #e3e9f0; border-radius: 10px; padding: .9rem 1.1rem; margin: .75rem 0; }
  .card h4 { margin: 0 0 .25rem; }
  .card p { margin: 0; color: #40505f; }
  .actions { counter-reset: step; list-style: none; padding: 0; }
  .actions li { counter-increment: step; position: relative; padding: .8rem 0 .8rem 2.5rem; border-bottom: 1px solid #eef2f6; }
  .actions li:last-child { border-bottom: none; }
  .actions li::before {
    content: counter(step); position: absolute; left: 0; top: .8rem;
    width: 1.7rem; height: 1.7rem; border-radius: 50%; background: #1f5fd0; color: #fff;
    font-size: .85rem; font-weight: 700; display: flex; align-items: center; justify-content: center;
  }
  .actions strong { display: block; }
  .options { display: grid; gap: .75rem; margin: 1rem 0; }
  @media (min-width: 40rem) { .options { grid-template-columns: 1fr 1fr; } }
  .option { border: 1px solid #e3e9f0; border-radius: 10px; padding: .9rem 1.1rem; }
  .option-recommended { border-color: #1f5fd0; background: #f6f9ff; }
  .tag { display: inline-block; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #1f5fd0; border: 1px solid currentColor; border-radius: 999px; padding: .05rem .5rem; vertical-align: middle; }
  .callout { border-left: 4px solid #1f5fd0; background: #f6f9ff; padding: .7rem .9rem; border-radius: 0 8px 8px 0; }
  .metric { border: 1px solid #e3e9f0; border-radius: 10px; padding: .85rem 1rem; margin: .6rem 0; }
  .metric-unknown { border-style: dashed; }
  .metric-head { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; flex-wrap: wrap; }
  .metric-label { font-weight: 600; }
  .metric-value { font-weight: 700; font-variant-numeric: tabular-nums; }
  .metric-meaning { margin: .35rem 0 0; color: #40505f; font-size: .95rem; }
  .metric-technical { margin: .35rem 0 0; color: #8895a3; font-size: .78rem; }
  table { border-collapse: collapse; width: 100%; margin: .75rem 0; font-size: .92rem; }
  th, td { border-bottom: 1px solid #e9eef3; padding: .5rem .55rem; text-align: left; vertical-align: top; }
  tbody th { width: 55%; font-weight: 600; color: #40505f; }
  .glossary dt { font-weight: 700; margin-top: .7rem; }
  .glossary dd { margin: .15rem 0 0; color: #40505f; }
  .tiny { color: #7a8794; font-size: .82rem; }
  details { margin: 1rem 0; }
  summary { cursor: pointer; font-weight: 600; padding: .6rem 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e3e9f0; color: #5d6b7a; font-size: .85rem; }
  @media print {
    body { max-width: none; padding: 0; font-size: 11.5pt; }
    h2 { break-after: avoid; }
    .card, .option, .metric, .verdict { break-inside: avoid; }
    details { display: block; }
    details > summary { list-style: none; }
  }
</style>
</head>
<body>

<h1>Your Debt Reality Check</h1>
<p class="sub">A plain-English summary of where you stand${generated ? ` &middot; ${esc(generated)}` : ''}</p>

<div class="verdict tier${n.tier}">
  <p class="says">${esc(n.plainTier.says)}</p>
  <p class="headline">${esc(n.headline)}</p>
  <p class="means"><strong>In plain English:</strong> ${esc(n.plainTier.means)}</p>
  <p class="tiernote">Technical rating: tier ${esc(n.tier)} of 4 (${esc(n.tierLabel)}).</p>
</div>

${body}

<footer>
  <p>${esc(DISCLAIMER)}</p>
  <p class="tiny">Generated on your own device. Nothing was sent anywhere.</p>
</footer>

</body>
</html>`;
}

export default { buildReport, reportSections, buildAppendix, toTextReport, toHtmlReport, toJsonReport, DISCLAIMER, PLAIN_TIER, gloss };
