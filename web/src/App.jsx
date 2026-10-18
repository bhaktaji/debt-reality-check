/**
 * web/src/App.jsx
 * The dashboard shell.
 *
 * Three screens, in order: a welcome that explains what this is, a guided audit that asks
 * one part of the household at a time in plain English, and a result that opens with a
 * human explanation before any number.
 *
 * Offline-first: all state lives in localStorage on this device, and all maths runs in the
 * browser through the shared core.
 */

import { useEffect, useMemo, useState } from 'react';
import { buildView, emptyProfile } from './model.js';
import { loadState, saveState, clearState, recordAudit, defaultState } from './storage.js';
import { GuidedStep } from './components/GuidedStep.jsx';
import { IncomeStep, CostsStep, BufferStep, HouseholdStep, DebtsStep } from './components/steps.jsx';
import { ResultNarrative, FoundSummary, PressurePoints, Improvement } from './components/ResultNarrative.jsx';
import { ActionPlan } from './components/ActionPlan.jsx';
import { PayoffComparison } from './components/PayoffComparison.jsx';
import { MetricDetails } from './components/MetricDetails.jsx';
import { AdvancedDetails } from './components/AdvancedDetails.jsx';
import { AuditHistory } from './components/AuditHistory.jsx';
import { ExpenseTracker } from './components/ExpenseTracker.jsx';
import { ReportExport } from './components/ReportExport.jsx';
import { ReportView } from './components/ReportView.jsx';
import { Badge } from './components/ui.jsx';

const STEPS = [
  { key: 'income', short: 'Income', title: 'Your income', blurb: 'What actually lands in your bank account each month.' },
  { key: 'costs', short: 'Costs', title: 'Your monthly costs', blurb: 'Housing and the essentials you cannot skip.' },
  { key: 'buffer', short: 'Safety net', title: 'Your safety net', blurb: 'The money you could reach quickly if something went wrong.' },
  { key: 'household', short: 'Household', title: 'Your household', blurb: 'Who earns, and who depends on that income.' },
  { key: 'debts', short: 'Debts', title: 'Your debts', blurb: 'Everything you pay each month. This is the part that matters most.' },
];

const SAMPLE_PROFILE = {
  netIncome: 60000,
  incomeStable: false,
  incomeHistory: [58000, 60000, 54000],
  rent: 12000,
  coreExpenses: 28000,
  liquidReserves: 40000,
  earners: 1,
  dependents: 2,
  familyHelp: false,
  debts: [
    { id: 'sample-1', name: 'HDFC credit card', choice: 'credit_card', type: 'revolving', secured: false, balance: 65000, minPayment: 3500, apr: 42, creditLimit: 100000 },
    { id: 'sample-2', name: 'Personal loan', choice: 'personal_loan', type: 'installment', secured: false, balance: 120000, minPayment: 4500, apr: 16, creditLimit: null },
    { id: 'sample-3', name: 'BNPL', choice: 'bnpl', type: 'bnpl', secured: false, balance: 15000, minPayment: 2000, apr: 30, creditLimit: null },
  ],
};

const SAMPLE_EXPENSES = [
  { amount: 1500, category: 'Utilities', isEssential: true, description: 'electricity', daysAgo: 1 },
  { amount: 3200, category: 'Groceries', isEssential: true, description: 'ration', daysAgo: 2 },
  { amount: 3000, category: 'Education & Childcare', isEssential: true, description: 'school', daysAgo: 3 },
  { amount: 250, category: 'Uncategorised', isEssential: false, description: 'business lunch', daysAgo: 4 },
  { amount: 900, category: 'Health', isEssential: true, description: 'medicine', daysAgo: 6 },
];

export default function App() {
  const [state, setState] = useState(() => loadState());
  const [showSampleNote, setShowSampleNote] = useState(false);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const profile = state.profile || emptyProfile();
  const stepKey = state.step || 'income';

  const view = useMemo(
    () => buildView(profile, state.expenses, { history: state.audits }),
    [profile, state.expenses, state.audits],
  );

  const updateProfile = (next) => setState((s) => ({ ...s, profile: next }));
  const goto = (step) => setState((s) => ({ ...s, step }));

  const addExpense = (e) =>
    setState((s) => ({
      ...s,
      expenses: [...s.expenses, { ...e, id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }],
    }));
  const removeExpense = (id) => setState((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) }));
  const clearExpenses = () => setState((s) => ({ ...s, expenses: [] }));

  const saveAudit = () => {
    if (!view.ok) return;
    setState((s) => ({ ...s, audits: recordAudit(s.audits, view.diagnostic) }));
  };

  const loadSample = () => {
    const now = Date.now();
    setState((s) => ({
      ...s,
      consent: true,
      profile: SAMPLE_PROFILE,
      expenses: SAMPLE_EXPENSES.map((e, i) => ({
        ...e,
        id: `sample-e${i}`,
        createdAt: new Date(now - e.daysAgo * 86400000).toISOString(),
      })),
      step: 'result',
      resultTab: 'summary',
    }));
    setShowSampleNote(true);
  };

  const eraseEverything = () => {
    clearState();
    setState(defaultState());
    setShowSampleNote(false);
  };

  /* ---------------- welcome ---------------- */

  if (!state.consent) {
    return (
      <main className="app">
        <div className="welcome">
          <Badge tone="neutral">Runs entirely on this device</Badge>
          <h1>Let’s understand where you stand financially.</h1>
          <p className="lead">
            Answer a few simple questions. You don’t need to know any finance terms — we’ll explain
            everything as we go.
          </p>

          <ul className="welcome-list">
            <li>Takes about three minutes.</li>
            <li>You get a plain-English summary and a plan, not a spreadsheet.</li>
            <li>No account, no sign-up, nothing sent anywhere.</li>
            <li>No loans, no referrals, nothing sold to you.</li>
          </ul>

          <details className="welcome-details">
            <summary>What happens to what I type?</summary>
            <ul className="prose-list">
              <li>Everything stays in this browser, on this device. There is no server call and no analytics.</li>
              <li>Clearing your browser data, or the DELETE MY DATA button, erases it permanently.</li>
              <li>Your numbers are used only to work out your situation and to cross-check your spending.</li>
              <li>
                This is informational only. It is not legal, tax or investment advice, and a qualified professional
                should review your individual circumstances.
              </li>
            </ul>
          </details>

          <div className="button-row">
            <button type="button" className="primary big" onClick={() => setState((s) => ({ ...s, consent: true }))}>
              Get started
            </button>
            <button type="button" className="ghost" onClick={loadSample}>
              Show me an example first
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ---------------- result ---------------- */

  if (stepKey === 'result') {
    const tab = state.resultTab || 'summary';

    return (
      <main className="app">
        <a className="skip-link" href="#result-main">
          Skip to the result
        </a>

        <header className="app-header">
          <div>
            <h1>Debt Reality Check</h1>
            <p className="tiny muted">Everything stays on this device.</p>
          </div>
          <div className="row">
            <button type="button" className="ghost small" onClick={() => goto('income')}>
              Change my answers
            </button>
          </div>
        </header>

        {showSampleNote ? (
          <p className="note warn">
            This is an example, not your data. Use “Change my answers” to enter your own numbers, or
            DELETE MY DATA at the bottom to clear it.
            <button type="button" className="link-btn" onClick={() => setShowSampleNote(false)}>
              Dismiss
            </button>
          </p>
        ) : null}

        <div className="tabs" role="tablist" aria-label="Result view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'summary'}
            onClick={() => setState((s) => ({ ...s, resultTab: 'summary' }))}
          >
            Summary
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'report'}
            onClick={() => setState((s) => ({ ...s, resultTab: 'report' }))}
          >
            My full report
          </button>
        </div>

        <div id="result-main">
          {!view.ok ? (
            <section className="block">
              <h2>Almost there</h2>
              <p>{view.message}</p>
              <button type="button" className="primary big" onClick={() => goto('income')}>
                Go back and add your income
              </button>
            </section>
          ) : tab === 'report' ? (
            <ReportView report={view.report} />
          ) : (
            <>
              <ResultNarrative report={view.report} />
              <FoundSummary report={view.report} />
              <PressurePoints report={view.report} />
              <ActionPlan report={view.report} />
              <PayoffComparison report={view.report} />
              <Improvement report={view.report} />
              <MetricDetails report={view.report} />
              <AdvancedDetails report={view.report} />

              <AuditHistory
                audits={state.audits}
                onSave={saveAudit}
                canSave={view.ok}
                onClear={() => setState((s) => ({ ...s, audits: [] }))}
              />

              <ExpenseTracker
                expenses={state.expenses}
                summary={view.summary}
                crossCheck={view.crossCheck}
                onAdd={addExpense}
                onRemove={removeExpense}
                onClear={clearExpenses}
              />

              <ReportExport
                report={view.report}
                profile={profile}
                expenses={state.expenses}
                audits={state.audits}
                canExport={view.ok}
                onImport={(imported) => setState((s) => ({ ...s, ...imported, consent: true }))}
                onErase={eraseEverything}
              />
            </>
          )}
        </div>

        <footer className="app-footer">
          <p>
            Informational only; not legal, tax or investment advice. No credit products are sold, brokered or
            referred.
          </p>
        </footer>
      </main>
    );
  }

  /* ---------------- guided audit ---------------- */

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === stepKey));
  const step = STEPS[stepIndex];

  const canContinue = {
    income: Number(profile.netIncome) > 0,
    costs: profile.coreExpenses !== null && profile.coreExpenses !== undefined,
    buffer: true,
    household: true,
    debts: true,
  }[step.key];

  const next = () => {
    if (stepIndex === STEPS.length - 1) {
      setState((s) => ({ ...s, step: 'result', resultTab: 'summary' }));
    } else {
      goto(STEPS[stepIndex + 1].key);
    }
  };

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>Debt Reality Check</h1>
          <p className="tiny muted">Answer a few simple questions. You don’t need to know finance terms.</p>
        </div>
        {Number(profile.netIncome) > 0 ? (
          <button type="button" className="ghost small" onClick={() => goto('result')}>
            Skip to my result
          </button>
        ) : null}
      </header>

      <GuidedStep
        stepIndex={stepIndex}
        steps={STEPS}
        title={step.title}
        blurb={step.blurb}
        onBack={stepIndex > 0 ? () => goto(STEPS[stepIndex - 1].key) : undefined}
        onNext={next}
        nextLabel={stepIndex === STEPS.length - 1 ? 'See my result' : 'Continue'}
        canContinue={canContinue}
        footnote={
          canContinue
            ? 'You can change any of this later.'
            : 'Add an income to continue. Everything else can be estimated.'
        }
      >
        {step.key === 'income' ? <IncomeStep profile={profile} onChange={updateProfile} /> : null}
        {step.key === 'costs' ? (
          <CostsStep profile={profile} onChange={updateProfile} prefillCore={view.ok ? view.summary.prefillCore : 0} />
        ) : null}
        {step.key === 'buffer' ? <BufferStep profile={profile} onChange={updateProfile} /> : null}
        {step.key === 'household' ? <HouseholdStep profile={profile} onChange={updateProfile} /> : null}
        {step.key === 'debts' ? <DebtsStep profile={profile} onChange={updateProfile} /> : null}
      </GuidedStep>
    </main>
  );
}
