/**
 * web/src/components/ActionPlan.jsx
 * "What I would focus on next" - three to five short, concrete actions.
 *
 * Advisory wording only; the words "prohibited" and "insolvent" never appear. The career
 * guidance that used to be a wall of text is now a single line plus a disclosure, and the
 * full engine directives live in the calculation details.
 */

import { Disclosure } from './ui.jsx';
import { CAREER_RISK } from '@core/policy.js';

export function ActionPlan({ report }) {
  const actions = report.narrative.actions;
  const career = report.career;

  if (!actions.length) return null;

  return (
    <section className="block" aria-labelledby="actions-heading">
      <h2 id="actions-heading">What I would focus on next</h2>
      <p className="tiny muted">A handful of things, in the order I would do them.</p>

      <ol className="actions">
        {actions.map((a) => (
          <li key={a.title}>
            <strong>{a.title}</strong>
            <span>{a.body}</span>
          </li>
        ))}
      </ol>

      <Disclosure summary="Should I change jobs or start something new?">
        <p>{career.trigger}</p>
        {career.applies ? (
          <>
            <p className="small">
              While things are tight, these are the moves worth postponing. It is about how predictable your
              income is, not about whether self-employment is a good idea in general.
            </p>
            <ul className="prose-list">
              {career.adviseAgainst.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="small">{career.permitted}</p>
        <p className="tiny muted">{CAREER_RISK.advisoryPrefix} your buffer is back above six months.</p>
      </Disclosure>

      <p className="tiny muted">
        Informational only - not legal, tax or investment advice. This tool never recommends investments or
        financial products. For anything investment-related, consult a SEBI-registered adviser.
      </p>
    </section>
  );
}

export default ActionPlan;
