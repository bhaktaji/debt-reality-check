/**
 * web/src/components/steps.jsx
 * The five screens of the guided audit.
 *
 * Each one asks about one part of the household, in plain English, with help on anything
 * technical. Advanced options sit behind a disclosure so they never block the main path.
 */

import { useState } from 'react';
import { MoneyField } from './MoneyField.jsx';
import { HelpTooltip, FieldLabel } from './HelpTooltip.jsx';
import { DebtCard } from './DebtCard.jsx';
import { parseAmount } from '@core/input.js';
import { inr } from '@core/formatting.js';
import { gloss } from '@core/plain_language.js';

/** A two-button yes/no choice, used instead of a select so the options are always visible. */
function ChoiceRow({ label, help, term, value, onChange, options }) {
  return (
    <div className="field">
      <span className="label-row">
        <span className="label-text">{label}</span>
        {help ? <HelpTooltip term={term ?? label}>{help}</HelpTooltip> : null}
      </span>
      <div className="choice-row">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className={`choice${value === o.value ? ' is-selected' : ''}`}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {value === o.value ? <span aria-hidden="true">✓ </span> : null}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 1. Income
 * ------------------------------------------------------------------ */

export function IncomeStep({ profile, onChange }) {
  const [historyText, setHistoryText] = useState((profile.incomeHistory || []).join(', '));
  const [historyError, setHistoryError] = useState(null);
  const stable = profile.incomeStable;

  const onHistory = (raw) => {
    setHistoryText(raw);
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const values = [];
    const bad = [];
    for (const p of parts) {
      const v = parseAmount(p);
      if (v === null) bad.push(p);
      else values.push(v);
    }
    setHistoryError(bad.length ? `I couldn't read: ${bad.join(', ')}. Use 60000, 60k or 1.5 lakh.` : null);
    if (!bad.length) onChange({ ...profile, incomeHistory: values });
  };

  return (
    <>
      <MoneyField
        id="netIncome"
        label="How much money comes into your household each month, after tax?"
        value={profile.netIncome}
        onChange={(v) => onChange({ ...profile, netIncome: v })}
        help="This is the amount you actually receive in your bank account, not your salary before deductions."
        required
        hint="If more than one person earns, add it all together."
      />

      <ChoiceRow
        label="Is your monthly income roughly the same every month?"
        value={stable === undefined ? null : stable}
        onChange={(v) => onChange({ ...profile, incomeStable: v })}
        options={[
          { value: true, label: "Yes, it's fairly stable" },
          { value: false, label: 'No, it changes a lot' },
        ]}
      />

      {stable === false ? (
        <div className="field">
          <label htmlFor="incomeHistory">Tell us your recent monthly income</label>
          <input
            id="incomeHistory"
            type="text"
            value={historyText}
            placeholder="e.g. 60000, 55000, 48000"
            aria-describedby="incomeHistory-help incomeHistory-error"
            aria-invalid={Boolean(historyError)}
            onChange={(e) => onHistory(e.target.value)}
          />
          <span className="hint" id="incomeHistory-help">
            The last three to six months, separated by commas. We use your lower recent income when checking how
            resilient your finances are, so a good month cannot hide a bad one.
          </span>
          {historyError ? (
            <span className="error" id="incomeHistory-error" role="alert">{historyError}</span>
          ) : null}
        </div>
      ) : null}

      {profile.incomeHistory?.length ? (
        <p className="note">
          We’ll base the audit on your lowest recent month: <strong>{inr(Math.min(...profile.incomeHistory))}</strong>.
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Costs
 * ------------------------------------------------------------------ */

export function CostsStep({ profile, onChange, prefillCore }) {
  return (
    <>
      <MoneyField
        id="rent"
        label="Monthly rent or housing payment"
        value={profile.rent}
        onChange={(v) => onChange({ ...profile, rent: v })}
        help="The unavoidable monthly cost of where you live. If you do not pay rent or a housing loan, enter 0."
      />

      <MoneyField
        id="coreExpenses"
        label="About how much do you spend each month on essentials?"
        value={profile.coreExpenses}
        onChange={(v) => onChange({ ...profile, coreExpenses: v })}
        help={gloss('essentials').what}
        hint="Food, electricity, medicine, transport, school fees and similar."
      />

      <p className="note">
        Rent and loan payments are counted separately, so leave them out here. You’ll add your debts in a
        moment.
      </p>

      {prefillCore > 0 ? (
        <p className="note good">
          From what you’ve logged in the last 30 days, your essentials come to about{' '}
          <strong>{inr(prefillCore)}</strong>.{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => onChange({ ...profile, coreExpenses: prefillCore })}
          >
            Use this
          </button>
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Buffer
 * ------------------------------------------------------------------ */

export function BufferStep({ profile, onChange }) {
  return (
    <>
      <MoneyField
        id="liquidReserves"
        label="How much money could you use right now if your income stopped?"
        value={profile.liquidReserves}
        onChange={(v) => onChange({ ...profile, liquidReserves: v })}
        cadence=""
        help={gloss('reserves').what}
        hint="Cash, savings and anything you could get to within a few days."
      />
      <p className="note">
        This is the money that decides how long you could cope if something went wrong. Do not include long-term
        investments or anything you cannot access quickly.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Household
 * ------------------------------------------------------------------ */

export function HouseholdStep({ profile, onChange }) {
  const set = (k) => (v) => onChange({ ...profile, [k]: v });

  return (
    <>
      <div className="field">
        <FieldLabel
          htmlFor="earners"
          help="People who bring money in, including you. Count part-time and irregular earners."
        >
          How many people currently earn money in the household?
        </FieldLabel>
        <input
          id="earners"
          type="number"
          inputMode="numeric"
          min="0"
          max="20"
          value={profile.earners ?? ''}
          onChange={(e) => set('earners')(e.target.value === '' ? null : Number(e.target.value))}
        />
      </div>

      <div className="field">
        <FieldLabel
          htmlFor="dependents"
          help="People who rely on that income without earning themselves - children, parents, anyone you support."
        >
          How many people depend financially on this household income?
        </FieldLabel>
        <input
          id="dependents"
          type="number"
          inputMode="numeric"
          min="0"
          max="20"
          value={profile.dependents ?? ''}
          onChange={(e) => set('dependents')(e.target.value === '' ? null : Number(e.target.value))}
        />
      </div>

      <ChoiceRow
        label="Could family help you out financially if you needed it?"
        help={gloss('familyHelp').what}
        term="family help"
        value={profile.familyHelp ?? null}
        onChange={set('familyHelp')}
        options={[
          { value: true, label: 'Yes, probably' },
          { value: false, label: 'No' },
        ]}
      />
      <p className="note">
        We show this for context only. It is never counted as income, because it may not be there when you need it.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 5. Debts
 * ------------------------------------------------------------------ */

export function DebtsStep({ profile, onChange }) {
  const debts = profile.debts ?? [];

  const add = () => {
    const id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    onChange({
      ...profile,
      debts: [
        ...debts,
        { id, name: '', choice: null, type: null, secured: null, balance: null, minPayment: null, apr: null, quote: null, creditLimit: null },
      ],
    });
  };

  const update = (id, next) => onChange({ ...profile, debts: debts.map((d) => (d.id === id ? next : d)) });
  const remove = (id) => onChange({ ...profile, debts: debts.filter((d) => d.id !== id) });

  const totalBalance = debts.reduce((s, d) => s + (Number(d.balance) || 0), 0);
  const totalMin = debts.reduce((s, d) => s + (Number(d.minPayment) || 0), 0);

  return (
    <>
      <p className="lead">Let’s look at your debts.</p>
      <p className="tiny muted">
        Add each one you pay every month - cards, loans, buy-now-pay-later, loan apps. If you genuinely do not know
        a figure, leave it blank rather than guessing.
      </p>

      {debts.length === 0 ? (
        <p className="note good">
          No debts added. If you don’t owe anything, just continue - that is a good place to be.
        </p>
      ) : null}

      <div className="debt-list">
        {debts.map((d, i) => (
          <DebtCard
            key={d.id}
            debt={d}
            index={i}
            onChange={(next) => update(d.id, next)}
            onRemove={() => remove(d.id)}
            canRemove={debts.length > 1}
          />
        ))}
      </div>

      <button type="button" className="primary big" onClick={add}>
        {debts.length ? 'Add another debt' : 'Add a debt'}
      </button>

      {debts.length ? (
        <p className="note">
          Across {debts.length} {debts.length === 1 ? 'debt' : 'debts'} you owe <strong>{inr(totalBalance)}</strong>,
          with minimum payments of <strong>{inr(totalMin)}</strong> a month.
        </p>
      ) : null}
    </>
  );
}

export default { IncomeStep, CostsStep, BufferStep, HouseholdStep, DebtsStep };
