/**
 * web/src/components/MetricDetails.jsx
 * "Your numbers" - each figure followed by what it actually means for the reader.
 *
 * The technical name is present but small and grey; the plain label and the sentence are
 * what carry the meaning.
 */

import { HelpTooltip } from './HelpTooltip.jsx';
import { gloss } from '@core/plain_language.js';

/** The glossary key for a metric, so the tooltip matches the number on screen. */
const TERM_FOR_METRIC = {
  foir: 'foir',
  dcf: 'dcf',
  runway: 'runway',
  interestBurn: 'interestBurn',
  debtLoad: 'debtLoad',
  creditUtilisation: 'creditUtilisation',
  unsecuredLines: null,
  monthsToDefault: 'runway',
};

export function PlainLanguageMetric({ metric }) {
  const termKey = TERM_FOR_METRIC[metric.key];
  return (
    <article className={`metric${metric.available ? '' : ' is-unknown'}`}>
      <div className="metric-head">
        <h3 className="metric-label">
          {metric.plainLabel}
          {termKey ? <HelpTooltip term={gloss(termKey).term}>{gloss(termKey).what}</HelpTooltip> : null}
        </h3>
        <p className="metric-value">{metric.value}</p>
      </div>
      <p className="metric-meaning">{metric.available ? metric.meaning : metric.why}</p>
      <p className="metric-technical">{metric.technicalLabel}</p>
    </article>
  );
}

export function MetricDetails({ report, heading = 'Your numbers', headingId = 'numbers-heading' }) {
  return (
    <section className="block" aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      <p className="tiny muted">Each figure is followed by what it actually means for you.</p>
      <div className="metrics">
        {report.metricsExplained.map((m) => (
          <PlainLanguageMetric key={m.key} metric={m} />
        ))}
      </div>
    </section>
  );
}

export default MetricDetails;
