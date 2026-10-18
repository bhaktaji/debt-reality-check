/**
 * web/src/components/PayoffComparison.jsx
 * "Your debt payoff plan" - two plain options, not a strategy table.
 *
 * "Avalanche" and "Snowball" survive only as small secondary labels, so anyone who has
 * read about them still recognises the terms without anyone else having to learn them.
 */

import { HelpTooltip } from './HelpTooltip.jsx';
import { gloss } from '@core/plain_language.js';

function Option({ option, help }) {
  return (
    <article className={`payoff-option${option.recommended ? ' is-recommended' : ''}`}>
      <h3>
        {option.name}
        {option.recommended ? <span className="pill">Suggested</span> : null}
      </h3>
      <p>{option.text}</p>
      <p className="tiny muted">
        Also called {option.technical} <HelpTooltip term={option.technical}>{help}</HelpTooltip>
      </p>
    </article>
  );
}

export function PayoffComparison({ report }) {
  const p = report.narrative.payoff;

  return (
    <section className="block" aria-labelledby="payoff-heading">
      <h2 id="payoff-heading">Your debt payoff plan</h2>

      {!p.feasible ? (
        <>
          <p className="lead">{p.intro}</p>
          <p>{p.detail}</p>
          <p className="callout">{p.nextStep}</p>
        </>
      ) : (
        <>
          <p className="lead">{p.intro}</p>
          <div className="payoff-options">
            <Option option={p.optionA} help={gloss('avalanche').what} />
            <Option option={p.optionB} help={gloss('snowball').what} />
          </div>
          <p className="callout">{p.differenceText}</p>
          <p>{p.suggestion}</p>
          {p.order?.length ? (
            <p className="tiny muted">
              The suggested order clears these debts as: {p.order.join(' → ')}.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export default PayoffComparison;
