/**
 * web/src/components/ResultNarrative.jsx
 * The first thing the user sees after an audit: a calm, human summary.
 *
 * No FOIR, no DCF, no tier arithmetic. Those live in the numbers section and the
 * calculation details, which the reader opens on purpose.
 */

import { HelpTooltip } from './HelpTooltip.jsx';
import { gloss } from '@core/plain_language.js';

export function ResultNarrative({ report }) {
  const n = report.narrative;

  return (
    <section className={`verdict verdict-${n.tier}`} aria-labelledby="verdict-says">
      <p className="verdict-says" id="verdict-says">{n.plainTier.says}</p>
      <p className="verdict-headline">{n.headline}</p>
      <p className="verdict-means">
        <strong>In plain English:</strong> {n.plainTier.means}
      </p>
      <p className="tiny muted">
        Technical rating: tier {n.tier} of 4 ({n.tierLabel}){' '}
        <HelpTooltip term="a tier">{gloss('tier').what}</HelpTooltip>
      </p>
    </section>
  );
}

/** "Here's what I found" - the position and what it means, in the user's own numbers. */
export function FoundSummary({ report }) {
  const n = report.narrative;
  return (
    <section className="block" aria-labelledby="found-heading">
      <h2 id="found-heading">Here’s what I found</h2>
      <div className="prose">
        {n.position.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <h3 className="sub-heading">What this means</h3>
      <ul className="prose-list">
        {n.whatItMeans.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

/** "Your biggest pressure points". */
export function PressurePoints({ report }) {
  const points = report.narrative.pressurePoints;
  if (!points.length) return null;
  return (
    <section className="block" aria-labelledby="pressure-heading">
      <h2 id="pressure-heading">Your biggest pressure points</h2>
      <div className="cards">
        {points.map((p) => (
          <article className="card soft" key={p.title}>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/** "How things could improve" - the distance-to-next-tier feature, in plain words. */
export function Improvement({ report }) {
  const imp = report.narrative.improvement;
  if (!imp.applicable) return null;
  return (
    <section className="block" aria-labelledby="improve-heading">
      <h2 id="improve-heading">How things could improve</h2>
      <ul className="prose-list">
        {imp.sentences.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </section>
  );
}

export default ResultNarrative;
