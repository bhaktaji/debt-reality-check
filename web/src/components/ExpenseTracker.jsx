/**
 * web/src/components/ExpenseTracker.jsx
 * "Did you spend anything today that you'd like to track?"
 *
 * One input, one sentence back. It uses the SAME parser as the bot, so "2 eggs 30",
 * "electricity 1500" and "1.5 lakh" behave identically here and on WhatsApp. Spend the
 * tool cannot classify is handed back to the user rather than silently labelled a cut
 * target, and essential spending is never presented as something to cut.
 */

import { useState } from 'react';
import { parseExpense } from '@core/expense_parser.js';
import { inr } from '@core/formatting.js';
import { HelpTooltip } from './HelpTooltip.jsx';

export function ExpenseTracker({ expenses, summary, crossCheck, onAdd, onRemove, onClear }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [justLogged, setJustLogged] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    setJustLogged(null);
    const parsed = parseExpense(text);
    if (parsed === null) {
      setError('I could not find an amount. Try something like "medicine 400" or "2 eggs 30".');
      return;
    }
    if (parsed.error === 'AMBIGUOUS_AMOUNT') {
      setError('I found two amounts in that message. Which one should I use?');
      return;
    }
    setError(null);
    if (parsed.isEssential === null) {
      setPending(parsed);
      return;
    }
    commit(parsed, parsed.isEssential);
  };

  const commit = (parsed, essential) => {
    onAdd({
      amount: parsed.amount,
      category: parsed.category,
      isEssential: essential,
      description: parsed.description,
      createdAt: new Date().toISOString(),
    });
    setJustLogged({ ...parsed, isEssential: essential });
    setText('');
    setPending(null);
  };

  return (
    <section className="block" aria-labelledby="expenses-heading">
      <h2 id="expenses-heading">Did you spend anything today?</h2>
      <p className="tiny muted">
        Optional, and it takes a second. Anything you log here cross-checks the costs in your audit.
      </p>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="expense-input" className="sr-only">
            What did you spend, and how much?
          </label>
          <div className="row nowrap">
            <input
              id="expense-input"
              className="grow"
              type="text"
              value={text}
              placeholder="e.g. medicine 400, electricity 1500, 2 eggs 30"
              aria-describedby={error ? 'expense-error' : 'expense-hint'}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
                setJustLogged(null);
              }}
            />
            <button type="submit" className="primary">Add</button>
          </div>
          <span className="hint" id="expense-hint">
            Amounts accept 60k, 1.5 lakh and 1,50,000. Rent, medicine, electricity, school fees and groceries are
            treated as essential
            <HelpTooltip term="essential spending">
              Food, medicine, electricity, transport and school fees. The things you need to keep the household
              running.
            </HelpTooltip>
          </span>
          {error ? (
            <span className="error" id="expense-error" role="alert">{error}</span>
          ) : null}
        </div>
      </form>

      {pending ? (
        <div className="note warn" role="status">
          <p>
            I’ve recorded <strong>{inr(pending.amount)}</strong> for “{pending.description || 'that item'}
            ”, but I’m not sure whether you’d consider that essential or discretionary.
          </p>
          <div className="button-row">
            <button type="button" className="small" onClick={() => commit(pending, true)}>Essential</button>
            <button type="button" className="small" onClick={() => commit(pending, false)}>Discretionary</button>
            <button type="button" className="small ghost" onClick={() => setPending(null)}>Discard</button>
          </div>
        </div>
      ) : null}

      {justLogged ? (
        <p className="note good" role="status">
          {inr(justLogged.amount)} for {justLogged.description || 'that item'}. I’ve classified this as{' '}
          <strong>
            {justLogged.isEssential === true ? 'essential' : justLogged.isEssential === false ? 'discretionary' : 'uncategorised'}
          </strong>
          {justLogged.category && justLogged.category !== 'Uncategorised' ? ` (${justLogged.category})` : ''}.
        </p>
      ) : null}

      {summary && summary.last30.count > 0 ? (
        <>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">Today</span>
              <strong>{inr(summary.today.total)}</strong>
              <span className="tiny muted">
                {summary.today.count} {summary.today.count === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Last {summary.windowDays} days</span>
              <strong>{inr(summary.last30.total)}</strong>
              <span className="tiny muted">{summary.last30.count} entries</span>
            </div>
            <div className="stat">
              <span className="stat-label">Essential / discretionary</span>
              <strong>
                {inr(summary.essential.total)} / {inr(summary.discretionary.total)}
              </strong>
              <span className="tiny muted">Essential is not a cut target</span>
            </div>
          </div>

          <details className="spend-detail">
            <summary>Where it went</summary>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Spending by category over the last 30 days</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCategory.map((c) => (
                    <tr key={c.category}>
                      <th scope="row">{c.category}</th>
                      <td>
                        {c.essential ? 'Essential' : c.uncategorised ? 'Uncategorised' : 'Discretionary'}
                      </td>
                      <td className="num">{inr(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summary.discretionaryByCategory?.length ? (
              <p className="small">
                Worth a look if you want to free up money: {summary.discretionaryByCategory.slice(0, 3).map((c) => `${c.category} (${inr(c.total)})`).join(', ')}.
              </p>
            ) : null}

            {crossCheck ? <p className="small">{crossCheck.message}</p> : null}

            <div className="table-wrap">
              <table>
                <caption className="sr-only">Recent expense entries</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="num">Amount</th>
                    <th scope="col"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.slice(0, 10).map((e) => (
                    <tr key={e.id}>
                      <td className="tiny">{new Date(e.createdAt).toLocaleString('en-IN')}</td>
                      <td>{e.category}</td>
                      <td className="num">{inr(e.amount)}</td>
                      <td>
                        <button type="button" className="link-btn danger" onClick={() => onRemove(e.id)}>
                          Remove<span className="sr-only"> the entry for {inr(e.amount)}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button type="button" className="link-btn danger" onClick={onClear}>
              Clear the whole expense log
            </button>
          </details>
        </>
      ) : (
        <p className="tiny muted">
          Nothing logged yet. Even a few entries make the cross-check more useful.
        </p>
      )}
    </section>
  );
}

export default ExpenseTracker;
