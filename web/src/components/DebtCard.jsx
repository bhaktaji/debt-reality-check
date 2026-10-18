/**
 * web/src/components/DebtCard.jsx
 * One debt, entered conversationally.
 *
 * Replaces the database-like table: a card per debt, one question at a time, with help on
 * anything technical. Nothing is inferred - the type is a deliberate choice, the secured
 * question is always asked, and a credit limit is only requested for credit cards and can
 * honestly be answered "I don't know", which leaves utilisation unknown rather than guessed.
 */

import { useState } from 'react';
import { MoneyField } from './MoneyField.jsx';
import { FieldLabel, HelpTooltip } from './HelpTooltip.jsx';
import { gloss, DEBT_TYPE_CHOICES, engineTypeForChoice, choiceForEngineType } from '@core/plain_language.js';
import { inr, pct } from '@core/formatting.js';
import { normaliseRate } from '@core/engine_v2.js';
export function DebtCard({ debt, index, onChange, onRemove, canRemove }) {
  const [showAdvanced, setShowAdvanced] = useState(Boolean(debt.quote));

  const set = (field, value) => onChange({ ...debt, [field]: value });

  const choice = debt.choice ?? (debt.type ? choiceForEngineType(debt.type) : null);
  const engineType = debt.type ?? (choice ? engineTypeForChoice(choice) : null);
  const isRevolving = engineType === 'revolving';

  const balance = Number(debt.balance) || 0;
  const minPayment = Number(debt.minPayment) || 0;
  const apr = Number(debt.apr) || 0;
  const monthlyInterest = apr > 0 ? (balance * apr) / 1200 : 0;
  const growsWhilePaying = balance > 0 && minPayment > 0 && monthlyInterest > 0 && minPayment <= monthlyInterest;
  const rate = normaliseRate(debt);

  const title = debt.name?.trim() || `Debt ${index + 1}`;

  return (
    <article className="debt-card" aria-labelledby={`debt-title-${debt.id}`}>
      <header className="debt-head">
        <h3 id={`debt-title-${debt.id}`}>{title}</h3>
        {canRemove ? (
          <button type="button" className="link-btn danger" onClick={onRemove}>
            Remove<span className="sr-only"> {title}</span>
          </button>
        ) : null}
      </header>

      <div className="field">
        <FieldLabel htmlFor={`debt-name-${debt.id}`} help="A short name you will recognise, like the bank and the product.">
          What would you like to call it?
        </FieldLabel>
        <input
          id={`debt-name-${debt.id}`}
          type="text"
          value={debt.name ?? ''}
          placeholder="e.g. HDFC credit card"
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div className="field">
        <FieldLabel htmlFor={`debt-type-${debt.id}`} help="Pick the closest match. If you are unsure, choose Something else.">
          What kind of debt is it?
        </FieldLabel>
        <select
          id={`debt-type-${debt.id}`}
          value={choice ?? ''}
          aria-invalid={!choice}
          onChange={(e) => {
            const id = e.target.value || null;
            onChange({ ...debt, choice: id, type: id ? engineTypeForChoice(id) : null });
          }}
        >
          <option value="">Choose one...</option>
          {DEBT_TYPE_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        {choice ? (
          <span className="hint">
            {DEBT_TYPE_CHOICES.find((c) => c.id === choice)?.help}{' '}
            <span className="muted tiny">(we record this as {engineType})</span>
          </span>
        ) : null}
      </div>

      <div className="field">
        <span className="label-row">
          <span className="label-text" id={`debt-secured-label-${debt.id}`}>
            Is something valuable tied to this loan, such as your vehicle or property?
          </span>
          <HelpTooltip term="a secured loan">
            A secured loan has something valuable tied to it, such as a vehicle or property. If you do not
            repay, the lender can take that asset.
          </HelpTooltip>
        </span>
        <div className="choice-row" role="radiogroup" aria-labelledby={`debt-secured-label-${debt.id}`}>
          {[
            { v: true, label: 'Yes' },
            { v: false, label: 'No' },
          ].map((opt) => (
            <button
              key={String(opt.v)}
              type="button"
              role="radio"
              aria-checked={debt.secured === opt.v}
              className={`choice${debt.secured === opt.v ? ' is-selected' : ''}`}
              onClick={() => set('secured', opt.v)}
            >
              {debt.secured === opt.v ? <span aria-hidden="true">✓ </span> : null}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <MoneyField
        id={`debt-balance-${debt.id}`}
        label="How much do you still owe?"
        value={debt.balance}
        onChange={(v) => set('balance', v)}
        cadence=""
        help="The outstanding amount right now, not what you originally borrowed."
      />

      <MoneyField
        id={`debt-min-${debt.id}`}
        label="What is the minimum payment each month?"
        value={debt.minPayment}
        onChange={(v) => set('minPayment', v)}
        help={gloss('minimumPayment').what}
      />

      <div className="field">
        <FieldLabel
          htmlFor={`debt-apr-${debt.id}`}
          help={gloss('apr').what}
          term="the interest rate"
        >
          What interest rate does it charge?
        </FieldLabel>
        <div className="input-suffix">
          <input
            id={`debt-apr-${debt.id}`}
            type="text"
            inputMode="decimal"
            value={debt.apr ?? ''}
            placeholder="e.g. 42"
            onChange={(e) => {
              const raw = e.target.value;
              set('apr', raw === '' ? null : Number.isFinite(Number(raw)) ? Number(raw) : null);
            }}
          />
          <span aria-hidden="true">% per year</span>
        </div>
        {rate.note ? <span className="hint">{rate.note}</span> : null}
        <button type="button" className="link-btn" onClick={() => setShowAdvanced((s) => !s)} aria-expanded={showAdvanced}>
          {showAdvanced ? 'Hide' : 'My lender quoted it differently'}
        </button>
      </div>

      {showAdvanced ? (
        <fieldset className="advanced-inline">
          <legend>Quoted differently?</legend>
          <p className="tiny muted">
            Some lenders quote a flat rate or a daily rate. Enter it here and we will convert it into a
            comparable yearly figure, including any upfront fee.
          </p>
          <div className="field">
            <label htmlFor={`debt-quote-basis-${debt.id}`}>How was it quoted?</label>
            <select
              id={`debt-quote-basis-${debt.id}`}
              value={debt.quote?.basis ?? ''}
              onChange={(e) => {
                const basis = e.target.value;
                set('quote', basis ? { basis, rate: debt.quote?.rate ?? null, months: debt.quote?.months ?? 6 } : null);
              }}
            >
              <option value="">It is a normal yearly rate</option>
              <option value="flat">A flat rate</option>
              <option value="daily">A daily rate</option>
            </select>
          </div>
          {debt.quote ? (
            <div className="grid two">
              <div className="field">
                <label htmlFor={`debt-quote-rate-${debt.id}`}>
                  {debt.quote.basis === 'daily' ? 'Rate per day (%)' : 'Flat rate per year (%)'}
                </label>
                <input
                  id={`debt-quote-rate-${debt.id}`}
                  type="text"
                  inputMode="decimal"
                  value={debt.quote.rate ?? ''}
                  onChange={(e) => set('quote', { ...debt.quote, rate: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </div>
              {debt.quote.basis === 'flat' ? (
                <div className="field">
                  <label htmlFor={`debt-quote-months-${debt.id}`}>Over how many months?</label>
                  <input
                    id={`debt-quote-months-${debt.id}`}
                    type="text"
                    inputMode="numeric"
                    value={debt.quote.months ?? ''}
                    onChange={(e) => set('quote', { ...debt.quote, months: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {rate.note ? <p className="note">{rate.note}</p> : null}
        </fieldset>
      ) : null}

      {isRevolving ? (
        <div className="field">
          <FieldLabel
            htmlFor={`debt-limit-${debt.id}`}
            help="We use this to estimate how much of your available card limit you are currently using. We will not guess it if you do not know it."
            term="the credit limit"
          >
            What is your credit limit?
          </FieldLabel>
          {debt.creditLimitUnknown ? (
            <p className="hint">
              Left as unknown. We will report your credit usage as unknown rather than estimate it.{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => onChange({ ...debt, creditLimitUnknown: false })}
              >
                Add it now
              </button>
            </p>
          ) : (
            <>
              <input
                id={`debt-limit-${debt.id}`}
                type="text"
                inputMode="numeric"
                value={debt.creditLimit ?? ''}
                placeholder="e.g. 100000"
                onChange={(e) => {
                  const raw = e.target.value;
                  set('creditLimit', raw === '' ? null : Number(raw.replace(/[^\d.]/g, '')) || null);
                }}
              />
              <button
                type="button"
                className="link-btn"
                onClick={() => onChange({ ...debt, creditLimit: null, creditLimitUnknown: true })}
              >
                I don’t know
              </button>
            </>
          )}
        </div>
      ) : null}

      {balance > 0 ? (
        <div className={`debt-summary${growsWhilePaying ? ' is-warning' : ''}`}>
          {monthlyInterest > 0 ? (
            <p>
              {growsWhilePaying ? (
                <>
                  <strong>This balance grows even when you pay on time.</strong> The minimum payment is{' '}
                  {inr(minPayment)}, but the interest each month is about {inr(monthlyInterest)}.
                </>
              ) : (
                <>
                  About <strong>{inr(monthlyInterest)}</strong> of your payment goes on interest each month
                  {apr > 0 ? ` (${pct(apr)} a year)` : ''}.
                </>
              )}
            </p>
          ) : (
            <p className="muted">Add a rate and we will show what this debt costs you each month.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

export default DebtCard;
