/**
 * bot/router.js
 * The one command router. Every channel adapter (Baileys prototype, official Cloud API,
 * the CLI, tests) feeds messages through this, so behaviour is identical everywhere.
 *
 * It owns the conversation state machine and the expense->audit loop, and it calls the
 * shared core for all maths. It never computes a financial figure itself.
 *
 * Channel-agnostic: no network, no WhatsApp types. Adapters pass (rawId, text).
 */

import { parseExpense } from '../core/expense_parser.js';
import { parseAmount, parseSingleAmount, parseYesNo, parseEssential, parseRateSpec } from '../core/input.js';
import { diagnoseProfile } from '../core/profile.js';
import { summariseExpenses, crossCheckCoreCosts, reviewTargets } from '../core/expense_history.js';
import { buildReport, toTextReport } from '../core/report.js';
import { TIER_LABELS } from '../core/policy.js';
import { engineTypeForChoice } from '../core/plain_language.js';
import { inr, pct, months as fmtMonths } from '../core/formatting.js';
import { profileFromStore, fieldsFromProfile } from '../store/mappers.js';
import * as M from './messages.js';

export const RETENTION_DAYS = 90;

/** The v2 audit order. Every field from Part II C.2 is asked for. */
const FLOW = ['netIncome', 'incomeHistory', 'rent', 'coreExpenses', 'liquidReserves', 'earners', 'dependents', 'familyHelp', 'debts', 'confirm'];

function freshState() {
  return {
    mode: 'idle',
    step: null,
    draft: null,
    pending: null,
    debt: null,
    history: [],
  };
}

function freshDraft(profile = {}) {
  return {
    netIncome: null, incomeHistory: [], rent: null, coreExpenses: null, liquidReserves: null,
    earners: 1, dependents: 0, familyHelp: false, debts: [],
    ...profile,
  };
}

/** Build the router. */
export function createRouter({ store, config = {} }) {
  const retentionDays = config.retentionDays ?? RETENTION_DAYS;

  const getState = (uid) => ({ ...freshState(), ...(store.users.get(uid)?.state || {}) });
  const saveState = (uid, state) => store.users.update(uid, { state_json: JSON.stringify(state) });

  const snapshotForBack = (state) => ({
    mode: state.mode, step: state.step, draft: JSON.parse(JSON.stringify(state.draft || null)),
    pending: state.pending ? { ...state.pending } : null,
    debt: state.debt ? JSON.parse(JSON.stringify(state.debt)) : null,
  });

  /* ------------------------------------------------------------------ *
   * Expense logging
   * ------------------------------------------------------------------ */

  function logExpense(uid, parsed) {
    const id = store.expenses.add(uid, {
      amount: parsed.amount,
      category: parsed.category,
      isEssential: parsed.isEssential,
      description: parsed.description,
    });
    store.events.log(uid, 'EXPENSE_LOGGED');
    return id;
  }

  function handleExpense(uid, text, state) {
    const parsed = parseExpense(text);

    if (parsed === null) {
      return { replies: [M.NO_EXPENSE], state };
    }
    if (parsed.error === 'AMBIGUOUS_AMOUNT') {
      return { replies: [M.EXPENSE_ASK_AMOUNT], state };
    }
    if (parsed.needsConfirm) {
      // Several numbers: confirm the amount before logging (10x slip guard).
      const next = { ...state, pending: { kind: 'expense', expense: parsed } };
      return { replies: [M.EXPENSE_CONFIRM(inr(parsed.amount), parsed.description)], state: next };
    }
    if (parsed.isEssential === null) {
      logExpense(uid, parsed);
      const next = { ...state, pending: { kind: 'classify', expenseId: null, expense: parsed } };
      return { replies: [M.EXPENSE_LOGGED(inr(parsed.amount), parsed.category, null), M.EXPENSE_ASK_ESSENTIAL], state: next };
    }
    logExpense(uid, parsed);
    return { replies: [M.EXPENSE_LOGGED(inr(parsed.amount), parsed.category, parsed.isEssential)], state };
  }

  /* ------------------------------------------------------------------ *
   * Audit flow
   * ------------------------------------------------------------------ */

  function askStep(step) {
    switch (step) {
      case 'netIncome': return M.AUDIT_QUESTIONS.netIncome;
      case 'incomeHistory': return M.AUDIT_QUESTIONS.incomeHistory;
      case 'rent': return M.AUDIT_QUESTIONS.rent;
      case 'coreExpenses': return M.AUDIT_QUESTIONS.coreExpenses;
      case 'liquidReserves': return M.AUDIT_QUESTIONS.liquidReserves;
      case 'earners': return M.AUDIT_QUESTIONS.earners;
      case 'dependents': return M.AUDIT_QUESTIONS.dependents;
      case 'familyHelp': return M.AUDIT_QUESTIONS.familyHelp;
      case 'debts': return M.AUDIT_QUESTIONS.debtName;
      case 'confirm': return M.AUDIT_SUMMARY_INTRO;
      default: return M.HELP;
    }
  }

  function startAudit(uid) {
    const existing = profileFromStore(store.users.get(uid), store.debts.list(uid));
    const draft = freshDraft({
      netIncome: existing?.netIncome ?? null,
      incomeHistory: existing?.incomeHistory ?? [],
      rent: existing?.rent ?? null,
      coreExpenses: existing?.coreExpenses ?? null,
      liquidReserves: existing?.liquidReserves ?? null,
      earners: existing?.earners ?? 1,
      dependents: existing?.dependents ?? 0,
      familyHelp: existing?.familyHelp ?? false,
      debts: [],
    });
    const state = { ...freshState(), mode: 'audit', step: 'netIncome', draft, history: [] };
    store.events.log(uid, 'AUDIT_STARTED');
    return { replies: [M.AUDIT_INTRO, askStep('netIncome')], state };
  }

  function advance(state) {
    const idx = FLOW.indexOf(state.step);
    const nextStep = FLOW[idx + 1] ?? 'confirm';
    const next = { ...state, step: nextStep, pending: null };
    if (nextStep === 'debts') {
      next.debt = { field: 'name', draft: {} };
      return { replies: [M.AUDIT_QUESTIONS.debtIntro, M.AUDIT_QUESTIONS.debtName], state: next };
    }
    if (nextStep === 'confirm') {
      return { replies: [M.AUDIT_SUMMARY_INTRO, summariseDraft(next.draft)], state: next };
    }
    return { replies: [askStep(nextStep)], state: next };
  }

  function summariseDraft(draft) {
    const lines = [
      `Income: ${inr(draft.netIncome)}/month${draft.incomeHistory?.length ? ` (history: ${draft.incomeHistory.map((n) => inr(n)).join(', ')})` : ''}`,
      `Rent: ${inr(draft.rent ?? 0)}`,
      `Core costs: ${inr(draft.coreExpenses ?? 0)}`,
      `Liquid reserves: ${inr(draft.liquidReserves ?? 0)}`,
      `Earners: ${draft.earners} | Dependents: ${draft.dependents} | Family help: ${draft.familyHelp ? 'yes' : 'no'}`,
      `Debts: ${draft.debts.length ? draft.debts.map((d) => `${d.name} (${d.type || 'type unknown'}, ${inr(d.balance)} @ ${d.apr == null ? 'rate unknown' : `${d.apr}%`})`).join('; ') : 'none'}`,
    ];
    return lines.join('\n');
  }

  function finishAudit(uid, state) {
    const profile = { ...state.draft };
    const diagnostic = diagnoseProfile(profile);
    if (!diagnostic.ok) {
      return { replies: [diagnostic.message, askStep('netIncome')], state: { ...state, step: 'netIncome' } };
    }

    // Persist the profile and the audit snapshot.
    store.users.update(uid, fieldsFromProfile(profile));
    store.debts.replaceAll(uid, profile.debts);
    store.audits.record(uid, diagnostic, { drivers: diagnostic.drivers, tier: diagnostic.tier });

    const expenses = summariseExpenses(store.expenses.listAll(uid), { now: new Date(), days: 30 });
    const cross = crossCheckCoreCosts(profile.coreExpenses, expenses);

    const report = buildReport(diagnostic, { profile: state.draft, expenses: { ...expenses, ...reviewTargets(expenses) }, expenseCrossCheck: cross });
    store.events.log(uid, 'AUDIT_COMPLETED');

    const next = { ...freshState() };
    return { replies: [toTextReport(report)], state: next };
  }

  function handleAuditAnswer(uid, text, state) {
    // A pending echo-confirmation takes priority.
    if (state.pending?.kind === 'echo') {
      const yes = parseYesNo(text);
      if (yes === true) {
        const { field, value } = state.pending;
        const draft = { ...state.draft, [field]: value };
        const cleared = { ...state, draft, pending: null };
        return advance(cleared);
      }
      if (yes === false) {
        const next = { ...state, pending: null };
        return { replies: [`No problem. ${askStep(state.step)}`], state: next };
      }
      return { replies: ['Reply YES to confirm the amount, or NO to re-enter it.'], state };
    }

    switch (state.step) {
      case 'netIncome':
      case 'rent':
      case 'coreExpenses':
      case 'liquidReserves': {
        const r = parseSingleAmount(text);
        if (!r.ok) return { replies: [badAmount(r.error), askStep(state.step)], state };
        // Only income must be positive. Rent, core costs and reserves can legitimately be
        // zero (Profile D has nil reserves); implausible values are flagged, never blocked.
        if (state.step === 'netIncome' && r.value <= 0) {
          return { replies: [`Income needs to be more than zero. ${askStep(state.step)}`], state };
        }
        const next = { ...state, pending: { kind: 'echo', field: state.step, value: r.value } };
        return { replies: [`You entered ${inr(r.value)} per month. Correct?`], state: next };
      }

      case 'incomeHistory': {
        if (/^\s*skip\s*$/i.test(text)) {
          const cleared = { ...state, draft: { ...state.draft, incomeHistory: [] }, pending: null };
          return advance(cleared);
        }
        const parts = text.split(/[,\n;]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
        const values = parts.map(parseAmount).filter((v) => v !== null);
        if (!values.length || values.length !== parts.length) {
          return { replies: [`I could not read every amount. Send them comma separated, e.g. "60000, 55000, 48000", or SKIP.`], state };
        }
        const cleared = { ...state, draft: { ...state.draft, incomeHistory: values }, pending: null };
        return advance(cleared);
      }

      case 'earners':
      case 'dependents': {
        const n = parseCount(text);
        if (n === null) return { replies: [`Send a whole number. ${askStep(state.step)}`], state };
        const cleared = { ...state, draft: { ...state.draft, [state.step]: n }, pending: null };
        return advance(cleared);
      }

      case 'familyHelp': {
        const yn = parseYesNo(text);
        if (yn === null) return { replies: [`Reply yes or no. ${askStep('familyHelp')}`], state };
        const cleared = { ...state, draft: { ...state.draft, familyHelp: yn }, pending: null };
        return advance(cleared);
      }

      case 'debts':
        return handleDebtAnswer(text, state);

      case 'confirm': {
        if (/^\s*done\s*$/i.test(text)) return finishAudit(uid, state);
        return { replies: ['Send DONE to run the diagnostic, or BACK to change an answer.'], state };
      }

      default:
        return { replies: [M.HELP], state: { ...freshState() } };
    }
  }

  function handleDebtAnswer(text, state) {
    const debt = state.debt || { field: 'name', draft: {} };
    const t = text.trim();

    switch (debt.field) {
      case 'name': {
        if (!t) return { replies: [M.AUDIT_QUESTIONS.debtName], state };
        const next = { ...state, debt: { field: 'type', draft: { ...debt.draft, name: t.slice(0, 40) } } };
        return { replies: [M.AUDIT_QUESTIONS.debtType], state: next };
      }
      case 'type': {
        const type = parseDebtType(t);
        if (!type) return { replies: [M.AUDIT_QUESTIONS.debtType], state };
        const next = { ...state, debt: { field: 'secured', draft: { ...debt.draft, type } } };
        return { replies: [M.AUDIT_QUESTIONS.debtSecured], state: next };
      }
      case 'secured': {
        const yn = parseYesNo(t);
        if (yn === null) return { replies: [M.AUDIT_QUESTIONS.debtSecured], state };
        const next = { ...state, debt: { field: 'balance', draft: { ...debt.draft, secured: yn } } };
        return { replies: [M.AUDIT_QUESTIONS.debtBalance], state: next };
      }
      case 'balance':
      case 'minPayment':
      case 'creditLimit': {
        // A credit limit may genuinely be unknown. Saying so is allowed, and the engine
        // then reports utilisation as unknown instead of inventing a number (F-05).
        if (debt.field === 'creditLimit' && /^\s*(skip|unknown|not sure|don'?t know|dont know|no idea|na|n\/a|idk)\s*$/i.test(t)) {
          return afterApr({ ...state, pending: null }, { ...debt.draft, creditLimitUnknown: true });
        }
        const r = parseSingleAmount(t);
        if (!r.ok) return { replies: [badAmount(r.error), M.AUDIT_QUESTIONS[`debt${cap(debt.field)}`]], state };
        const next = { ...state, pending: { kind: 'debtEcho', field: debt.field, value: r.value } };
        return { replies: [`You entered ${inr(r.value)}. Correct?`], state: next };
      }
      case 'apr': {
        const spec = parseRateSpec(t);
        if (!spec) {
          return { replies: [`I could not read that rate. Send "42", or "flat 24 6", or "0.1 per day".`], state };
        }
        const draft = { ...debt.draft, ...spec };
        if (draft.apr != null && draft.apr > 100) {
          const next = { ...state, pending: { kind: 'rateClarify', draft } };
          return { replies: [`${draft.apr}% is high. Is that per year or per month? Reply YEAR or MONTH.`], state: next };
        }
        return afterApr(state, draft);
      }
      case 'more': {
        if (/^\s*(done|no|nope|none|nil|that'?s all|finish)\s*$/i.test(t)) {
          return advance({ ...state, debt: null, step: 'debts' });
        }
        if (/^\s*(next|another|add|more)\s*$/i.test(t)) {
          return { replies: [M.AUDIT_QUESTIONS.debtName], state: { ...state, debt: { field: 'name', draft: {} } } };
        }
        // Anything else is the name of the next debt - forgiving, and it keeps a plain
        // "no" from being mistaken for a debt name.
        return {
          replies: [M.AUDIT_QUESTIONS.debtType],
          state: { ...state, debt: { field: 'type', draft: { name: t.slice(0, 40) } } },
        };
      }
      default:
        return { replies: [M.AUDIT_QUESTIONS.debtName], state: { ...state, debt: { field: 'name', draft: {} } } };
    }
  }

  function afterApr(state, debtDraft) {
    if (debtDraft.type === 'revolving' && !(Number(debtDraft.creditLimit) > 0) && !debtDraft.creditLimitUnknown) {
      const next = { ...state, debt: { field: 'creditLimit', draft: debtDraft } };
      return { replies: [M.AUDIT_QUESTIONS.debtCreditLimit], state: next };
    }
    return pushDebt(state, debtDraft);
  }

  function pushDebt(state, debtDraft) {
    const draft = { ...state.draft, debts: [...(state.draft.debts || []), debtDraft] };
    const next = { ...state, draft, debt: { field: 'more', draft: {} } };
    return { replies: [`Added ${debtDraft.name}. ${M.AUDIT_QUESTIONS.debtMore}`], state: next };
  }

  /* ------------------------------------------------------------------ *
   * Debt-echo / clarification pending states
   * ------------------------------------------------------------------ */

  function handlePending(uid, text, state) {
    const p = state.pending;

    if (p.kind === 'expense') {
      const yes = parseYesNo(text);
      if (yes === true) {
        logExpense(uid, p.expense);
        const next = { ...state, pending: p.expense.isEssential === null ? { kind: 'classify', expense: p.expense } : null };
        const replies = [M.EXPENSE_LOGGED(inr(p.expense.amount), p.expense.category, p.expense.isEssential)];
        if (next.pending) replies.push(M.EXPENSE_ASK_ESSENTIAL);
        return { replies, state: next };
      }
      if (yes === false) return { replies: [M.EXPENSE_ASK_AMOUNT], state: { ...state, pending: null } };
      return { replies: [M.EXPENSE_CONFIRM(inr(p.expense.amount), p.expense.description)], state };
    }

    if (p.kind === 'classify') {
      const essential = parseEssential(text);
      if (essential === null) return { replies: [M.EXPENSE_ASK_ESSENTIAL], state };
      store.expenses.add(uid, { ...p.expense, isEssential: essential, description: p.expense.description });
      const next = { ...state, pending: null };
      return { replies: [M.EXPENSE_LOGGED(inr(p.expense.amount), p.expense.category, essential)], state: next };
    }

    if (p.kind === 'debtEcho') {
      const yes = parseYesNo(text);
      if (yes === true) {
        const debt = { ...state.debt, draft: { ...state.debt.draft, [p.field]: p.value } };
        const cleared = { ...state, debt, pending: null };
        if (p.field === 'balance') return { replies: [M.AUDIT_QUESTIONS.debtMinPayment], state: { ...cleared, debt: { ...debt, field: 'minPayment' } } };
        if (p.field === 'minPayment') return { replies: [M.AUDIT_QUESTIONS.debtApr], state: { ...cleared, debt: { ...debt, field: 'apr' } } };
        if (p.field === 'creditLimit') return afterApr({ ...cleared, pending: null }, debt.draft);
        return { replies: [M.AUDIT_QUESTIONS.debtMore], state: cleared };
      }
      if (yes === false) {
        return { replies: [`Re-enter it. ${M.AUDIT_QUESTIONS[`debt${cap(p.field)}`]}`], state: { ...state, pending: null } };
      }
      return { replies: ['Reply YES to confirm, or NO to re-enter.'], state };
    }

    if (p.kind === 'rateClarify') {
      const s = text.trim().toLowerCase();
      if (s.startsWith('year') || s === 'y') {
        return afterApr({ ...state, pending: null }, p.draft);
      }
      if (s.startsWith('month') || s === 'm') {
        const apr = p.draft.apr * 12;
        return afterApr({ ...state, pending: null }, { ...p.draft, apr, quote: null });
      }
      return { replies: ['Reply YEAR or MONTH.'], state };
    }

    return { replies: [M.HELP], state: { ...state, pending: null } };
  }

  /* ------------------------------------------------------------------ *
   * Commands
   * ------------------------------------------------------------------ */

  function handleCommand(uid, upper, text, state) {
    if (upper === 'HELP' || upper === '?') return { replies: [M.HELP], state };
    if (upper === 'AGREE') {
      store.consent.record(uid, { noticeVersion: M.NOTICE_VERSION, purpose: 'solvency diagnostic and expense log', retentionDays });
      store.events.log(uid, 'CONSENT_RECORDED');
      return { replies: [M.CONSENT_ACK], state };
    }
    if (upper === 'DELETE MY DATA' || upper === 'DELETE-MY-DATA' || upper === 'DELETE_DATA') {
      store.retention.deleteAllFor(uid);
      return { replies: [M.DELETE_ACK], state: freshState() };
    }
    if (upper === 'CANCEL') {
      store.events.log(uid, 'FLOW_CANCELLED');
      return { replies: [M.CANCEL_ACK], state: freshState() };
    }
    if (upper === 'BACK') {
      if (!state.history?.length) return { replies: [M.NO_BACK], state };
      const history = [...state.history];
      const prev = history.pop();
      const restored = { ...freshState(), ...prev, history };
      return { replies: [M.BACK_ACK, askStep(restored.step) || ''].filter(Boolean), state: restored };
    }
    if (upper.startsWith('SET CURRENCY')) {
      const code = upper.replace('SET CURRENCY', '').trim();
      if (code && code !== 'INR') return { replies: [M.SET_CURRENCY_UNSUPPORTED], state };
      store.users.update(uid, { currency: 'INR' });
      return { replies: [M.SET_CURRENCY_ACK('INR')], state };
    }
    if (upper === 'SUMMARY') return { replies: [summaryText(uid)], state };
    if (upper === 'HISTORY') return { replies: [historyText(uid)], state };
    if (upper === 'REPORT') return { replies: [reportText(uid)], state };
    if (upper === 'AUDIT') return startAudit(uid);
    if (upper === 'HARASSMENT') return { replies: [M.HARASSMENT_GUIDANCE], state };
    return null;
  }

  function summaryText(uid) {
    const all = store.expenses.listAll(uid);
    if (!all.length) return M.NO_EXPENSES;
    const s = summariseExpenses(all, { now: new Date(), days: 30 });
    const lines = [
      `${M.SUMMARY_HEADER}`,
      `Today: ${inr(s.today.total)} across ${s.today.count} entries`,
      `Last ${s.windowDays} days: ${inr(s.last30.total)} across ${s.last30.count} entries`,
      '',
      'By category:',
      ...s.byCategory.map((c) => `- ${c.category}: ${inr(c.total)} (${c.count})`),
      '',
      `Essential ${inr(s.essential.total)} | Discretionary ${inr(s.discretionary.total)} | Uncategorised ${inr(s.uncategorised.total)}`,
      'Essential spending is not a cut target.',
    ];
    if (s.recurring.length) {
      lines.push('', 'Recurring:', ...s.recurring.slice(0, 5).map((r) => `- ${r.category}: ${inr(r.total)} over ${r.daysSeen} days`));
    }
    return lines.join('\n');
  }

  function historyText(uid) {
    const trend = store.audits.trend(uid);
    if (!trend.length) return M.REPORT_NEEDS_AUDIT;
    const lines = ['AUDIT HISTORY'];
    for (const h of trend) {
      const move = h.previousTier === null ? 'first audit' : h.tierChange === 0 ? 'no change' : h.tierChange < 0 ? `improved from tier ${h.previousTier}` : `worsened from tier ${h.previousTier}`;
      lines.push(`${h.takenAt} - Tier ${h.tier} (${TIER_LABELS[h.tier]}), FOIR ${pct(h.foir)}, runway ${fmtMonths(h.runway)} - ${move}`);
    }
    return lines.join('\n');
  }

  function reportText(uid) {
    const profile = profileFromStore(store.users.get(uid), store.debts.list(uid));
    if (!profile || profile.netIncome == null) return M.REPORT_NEEDS_AUDIT;
    const diagnostic = diagnoseProfile(profile);
    if (!diagnostic.ok) return diagnostic.message;
    const expenses = summariseExpenses(store.expenses.listAll(uid), { now: new Date(), days: 30 });
    return toTextReport(buildReport(diagnostic, {
      profile,
      expenses: { ...expenses, ...reviewTargets(expenses) },
      expenseCrossCheck: crossCheckCoreCosts(profile.coreExpenses, expenses),
      history: store.audits.list(uid, 10),
    }));
  }

  /* ------------------------------------------------------------------ *
   * Entry point
   * ------------------------------------------------------------------ */

  function handle(rawId, text) {
    const uid = store.pseudonymise(rawId);
    store.users.ensure(uid);

    const body = String(text ?? '').trim();
    const upper = body.toUpperCase();

    // Crisis always wins, and stops the flow (F.3).
    if (M.isCrisisMessage(body)) {
      store.events.log(uid, 'CRISIS_ESCALATION');
      return { replies: [M.CRISIS_REPLY], state: freshState(), escalated: true };
    }

    const state = getState(uid);

    // First contact: consent notice before anything else (except HELP / DELETE).
    if (!store.consent.hasConsent(uid) && !['AGREE', 'HELP', '?', 'DELETE MY DATA'].includes(upper)) {
      const out = { replies: [M.FIRST_CONTACT], state };
      saveState(uid, state);
      return out;
    }

    // Commands
    const cmd = handleCommand(uid, upper, body, state);
    if (cmd) {
      if (M.isHarassmentMessage(body)) cmd.replies.push('', M.HARASSMENT_GUIDANCE);
      saveState(uid, cmd.state);
      return cmd;
    }

    // Pending confirmations / clarifications. A money echo is part of the audit flow.
    if (state.pending) {
      const out = state.pending.kind === 'echo'
        ? handleAuditAnswer(uid, body, state)
        : handlePending(uid, body, state);
      if (M.isHarassmentMessage(body)) out.replies.push('', M.HARASSMENT_GUIDANCE);
      saveState(uid, out.state);
      return out;
    }

    // Audit flow
    if (state.mode === 'audit') {
      const before = snapshotForBack(state);
      const out = handleAuditAnswer(uid, body, state);
      const progressed =
        out.state.step !== state.step ||
        out.state.pending?.kind === 'echo' ||
        out.state.pending?.kind === 'debtEcho';

      // The expense log stays available at any stage: if the message was not a usable
      // answer for this step but does parse as an expense, log it and carry on.
      if (!progressed && !state.pending) {
        const parsed = parseExpense(body);
        if (parsed && !parsed.error && parsed.isEssential !== null) {
          logExpense(uid, parsed);
          out.replies = [M.EXPENSE_LOGGED(inr(parsed.amount), parsed.category, parsed.isEssential), ...out.replies];
        }
      }

      // Only push history when we actually progressed.
      if (progressed) {
        out.state = { ...out.state, history: [...(state.history || []).slice(-20), before] };
      }
      if (M.isHarassmentMessage(body)) out.replies.push('', M.HARASSMENT_GUIDANCE);
      saveState(uid, out.state);
      return out;
    }

    // Idle: try to log an expense. The expense log works at any stage.
    const out = handleExpense(uid, body, state);
    if (M.isHarassmentMessage(body)) out.replies.push('', M.HARASSMENT_GUIDANCE);
    saveState(uid, out.state);
    return out;
  }

  return { handle, startAudit, finishAudit, summaryText, historyText, reportText, retentionDays, store };
}

/* -------------------------------------------------------------------- */

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseCount(text) {
  const m = String(text).trim().match(/^(\d{1,3})$/);
  if (!m) return null;
  return Number(m[1]);
}

function parseDebtType(text) {
  const s = String(text).trim().toLowerCase();
  // Numbers follow the friendly list shown in the question and on the dashboard.
  const byNumber = { 1: 'credit_card', 2: 'personal_loan', 3: 'bnpl', 4: 'loan_app', 5: 'vehicle_loan', 6: 'other' };
  if (byNumber[s]) return engineTypeForChoice(byNumber[s]);

  const words = [
    [['credit card', 'card', 'cc', 'revolving'], 'credit_card'],
    [['personal loan', 'instalment', 'installment', 'loan', 'emi'], 'personal_loan'],
    [['bnpl', 'buy now', 'buy now pay later'], 'bnpl'],
    [['loan app', 'loanapp', 'app'], 'loan_app'],
    [['vehicle', 'car loan', 'bike', 'two wheeler'], 'vehicle_loan'],
    [['other', 'something else', 'none of these'], 'other'],
  ];
  for (const [names, choice] of words) {
    if (names.includes(s)) return engineTypeForChoice(choice);
  }
  return null;
}

function badAmount(error) {
  switch (error) {
    case 'UNKNOWN_SUFFIX': return 'That suffix is not one I recognise. Use k, lakh or crore, or plain rupees.';
    case 'AMBIGUOUS_AMOUNT': return 'I found more than one number. Send just the amount, e.g. "60000" or "1.5 lakh".';
    case 'NEGATIVE': return 'Amounts must be positive.';
    case 'EMPTY': return 'That was empty. Send the amount.';
    default: return 'I could not read that as an amount. Send it like "60000" or "1.5 lakh".';
  }
}

export default { createRouter, RETENTION_DAYS };
