/**
 * web/src/components/AdvancedDetails.jsx
 * The technical appendix: exact figures, tier arithmetic, credit-stress indicators and the
 * glossary. Collapsed by default everywhere, so it never competes with the narrative.
 */

import { Disclosure } from './ui.jsx';
import { buildAppendix } from '@core/report.js';

function KeyValueTable({ rows, caption }) {
  return (
    <table className="kv">
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BulletList({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="prose-list">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function Appendix({ appendix }) {
  return (
    <div className="appendix">
      <h3>Tier assignment</h3>
      <KeyValueTable rows={appendix.tier} caption="How the tier was assigned" />
      <BulletList items={appendix.explanation} />
      <BulletList items={appendix.notes} />

      <h3>Raw metrics</h3>
      <KeyValueTable rows={appendix.raw} caption="Every figure behind the verdict" />

      <h3>Credit-stress indicators</h3>
      <p className="tiny muted">{appendix.creditStressNote}</p>
      <KeyValueTable rows={appendix.creditStress} caption="Credit-stress indicators" />

      <h3>Payoff simulation</h3>
      <KeyValueTable rows={appendix.payoff} caption="Payoff simulation results" />

      {appendix.warnings.length ? (
        <>
          <h3>Data checks</h3>
          <BulletList items={appendix.warnings} />
        </>
      ) : null}

      {appendix.questions.length ? (
        <>
          <h3>Not provided</h3>
          <BulletList items={appendix.questions} />
        </>
      ) : null}

      <h3>What the terms mean</h3>
      <dl className="glossary">
        {appendix.glossary.map((g) => (
          <div key={g.key}>
            <dt>{g.term}</dt>
            <dd>{g.what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AdvancedDetails({ report }) {
  return (
    <section className="block" aria-labelledby="advanced-heading">
      <h2 id="advanced-heading">How we calculated this</h2>
      <p className="tiny muted">
        Nothing here is estimated. If a figure was missing, it says so instead of filling it in.
      </p>
      <Disclosure summary="Show the full calculation details">
        <Appendix appendix={buildAppendix(report)} />
      </Disclosure>
    </section>
  );
}

export default AdvancedDetails;
