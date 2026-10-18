/**
 * web/src/components/ReportView.jsx
 * The report, on screen.
 *
 * It walks the SAME section list as the HTML export (core/report.js -> reportSections), so
 * what you read here is exactly what you download. There is no second layout to keep in
 * sync and no second calculation anywhere.
 */

import { reportSections } from '@core/report.js';
import { ResultNarrative } from './ResultNarrative.jsx';
import { PlainLanguageMetric } from './MetricDetails.jsx';
import { Appendix } from './AdvancedDetails.jsx';
import { Disclosure } from './ui.jsx';
import { inr } from '@core/formatting.js';

function Section({ section }) {
  switch (section.kind) {
    case 'paragraphs':
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          <div className="prose">
            {section.items.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      );

    case 'cards':
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          <div className="cards">
            {section.items.map((c) => (
              <article className="card soft" key={c.title}>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </section>
      );

    case 'steps':
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          <ol className="actions">
            {section.items.map((a) => (
              <li key={a.title}>
                <strong>{a.title}</strong>
                <span>{a.body}</span>
              </li>
            ))}
          </ol>
        </section>
      );

    case 'bullets':
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          <ul className="prose-list">
            {section.items.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      );

    case 'payoff': {
      const p = section.payoff;
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          {p.feasible ? (
            <>
              <p className="lead">{p.intro}</p>
              <div className="payoff-options">
                <article className={`payoff-option${p.optionA.recommended ? ' is-recommended' : ''}`}>
                  <h3>Option 1: {p.optionA.name}{p.optionA.recommended ? <span className="pill">Suggested</span> : null}</h3>
                  <p>{p.optionA.text}</p>
                  <p className="tiny muted">Also called {p.optionA.technical}.</p>
                </article>
                <article className={`payoff-option${p.optionB.recommended ? ' is-recommended' : ''}`}>
                  <h3>Option 2: {p.optionB.name}{p.optionB.recommended ? <span className="pill">Suggested</span> : null}</h3>
                  <p>{p.optionB.text}</p>
                  <p className="tiny muted">Also called {p.optionB.technical}.</p>
                </article>
              </div>
              <p className="callout">{p.differenceText}</p>
              <p>{p.suggestion}</p>
            </>
          ) : (
            <>
              <p className="lead">{p.intro}</p>
              <p>{p.detail}</p>
              <p className="callout">{p.nextStep}</p>
            </>
          )}
        </section>
      );
    }

    case 'metrics':
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          {section.intro ? <p className="tiny muted">{section.intro}</p> : null}
          <div className="metrics">
            {section.items.map((m) => (
              <PlainLanguageMetric key={m.key} metric={m} />
            ))}
          </div>
        </section>
      );

    case 'spending': {
      const e = section.expenses;
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          <p>
            In the last {e.windowDays} days you logged {inr(e.last30.total)} across {e.last30.count} entries.
            Today: {inr(e.today.total)}.
          </p>
          <p>
            Essential {inr(e.essential.total)} · Discretionary {inr(e.discretionary.total)} · Uncategorised{' '}
            {inr(e.uncategorised.total)}.
          </p>
          <p className="tiny muted">Essential spending is not a cut target.</p>
          {section.crossCheck ? <p>{section.crossCheck.message}</p> : null}
        </section>
      );
    }

    case 'history':
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Previous audits and how your position moved</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Position</th>
                  <th scope="col">Tier</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((h) => (
                  <tr key={h.takenAt + h.tier}>
                    <td className="tiny">{h.takenAt}</td>
                    <td>{h.plainTierName ?? h.tierLabel ?? ''}</td>
                    <td>{h.tier} of 4</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );

    case 'appendix':
      return (
        <section className="block" aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`}>{section.heading}</h2>
          <p className="tiny muted">Nothing here is estimated. Missing figures are marked as unknown.</p>
          <Disclosure summary="Show the full calculation details">
            <Appendix appendix={section.appendix} />
          </Disclosure>
        </section>
      );

    default:
      return null;
  }
}

export function ReportView({ report }) {
  const sections = reportSections(report);
  return (
    <div className="report-doc">
      <header className="report-head">
        <h1>Your Debt Reality Check</h1>
        <p className="tiny muted">
          A plain-English summary of where you stand
          {report.generatedAt ? ` · ${new Date(report.generatedAt).toLocaleString('en-IN')}` : ''}
        </p>
      </header>

      <ResultNarrative report={report} />

      {sections.map((s) => (
        <Section key={s.id} section={s} />
      ))}

      <footer className="report-foot">
        <p>{report.disclaimer}</p>
      </footer>
    </div>
  );
}

export default ReportView;
