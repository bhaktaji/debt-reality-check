/**
 * core/profile.js
 * The single adapter between a raw user profile and the diagnostic engine.
 *
 * Both the bot and the dashboard call buildDiagnosticInput(), so the two surfaces
 * cannot drift apart (F-03, F-22). Debt rates are normalised here via normaliseRate(),
 * and nothing is ever inferred: a missing type, secured flag or credit limit stays
 * missing and is reported as a question by checkPlausibility().
 *
 * Pure. No I/O.
 */

import { normaliseRate, runDiagnosticV2 } from './engine_v2.js';
import { checkPlausibility } from './plausibility.js';

export const DEBT_TYPES = Object.freeze(['installment', 'revolving', 'bnpl', 'loanapp']);

export const DEBT_TYPE_LABELS = Object.freeze({
  installment: 'Installment loan',
  revolving: 'Revolving credit (card / line)',
  bnpl: 'Buy-now-pay-later',
  loanapp: 'Digital loan app',
});

/** An empty profile with every v2 field present and explicitly unknown where unknown. */
export function emptyProfile() {
  return {
    netIncome: null,
    incomeHistory: [],
    rent: null,
    coreExpenses: null,
    liquidReserves: null,
    earners: 1,
    dependents: 0,
    familyHelp: false,
    debts: [],
  };
}

/** An empty debt row. `type`/`secured`/`creditLimit` are null, never guessed. */
export function emptyDebt(id) {
  return {
    id: id ?? `debt-${Math.abs(hashString(String(id ?? '')))}`,
    name: '',
    type: null,
    secured: null,
    balance: null,
    minPayment: null,
    apr: null,
    quote: null,
    creditLimit: null,
  };
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Normalise one debt row into the engine's shape. Rate is normalised through
 * normaliseRate(); an unknown rate stays null so it can be flagged, never back-filled.
 */
export function normaliseDebt(debt = {}, index = 0) {
  const rate = normaliseRate(debt);
  return {
    id: debt.id ?? `debt-${index}`,
    name: debt.name || `Debt ${index + 1}`,
    type: debt.type ?? null,
    secured: debt.secured ?? null,
    balance: toNumberOrNull(debt.balance),
    minPayment: toNumberOrNull(debt.minPayment),
    creditLimit: toNumberOrNull(debt.creditLimit),
    apr: rate.apr,
    rateSource: rate.source,
    rateNote: rate.note ?? null,
    quote: debt.quote ?? null,
  };
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the engine input from a raw profile. This is THE shared path.
 * @returns {object} diagnostic input
 */
export function buildDiagnosticInput(profile = {}) {
  const debts = (Array.isArray(profile.debts) ? profile.debts : [])
    .filter((d) => d && (Number(d.balance) > 0 || Number(d.minPayment) > 0))
    .map((d, i) => normaliseDebt(d, i));

  return {
    netIncome: toNumberOrNull(profile.netIncome),
    incomeHistory: (Array.isArray(profile.incomeHistory) ? profile.incomeHistory : [])
      .map((n) => toNumberOrNull(n))
      .filter((n) => n !== null && n > 0),
    rent: toNumberOrNull(profile.rent) ?? 0,
    coreExpenses: toNumberOrNull(profile.coreExpenses) ?? 0,
    liquidReserves: toNumberOrNull(profile.liquidReserves) ?? 0,
    earners: toNumberOrNull(profile.earners) ?? 1,
    dependents: toNumberOrNull(profile.dependents) ?? 0,
    familyHelp: Boolean(profile.familyHelp),
    debts,
    profile: { ...profile, debts },
  };
}

/** Convenience: profile -> full v2 diagnostic, using the one shared engine. */
export function diagnoseProfile(profile, options = {}) {
  return runDiagnosticV2({ ...buildDiagnosticInput(profile), ...options });
}

/** Plausibility / missing-data report for a raw profile. */
export function reviewProfile(profile = {}) {
  return checkPlausibility({ ...emptyProfile(), ...profile });
}

/**
 * The v2 fields an audit MUST collect (task section 14). The old 5-step flow is
 * insufficient because it omits rent, income history, earners, family help, debt type,
 * secured status and credit limits.
 */
export const AUDIT_FIELDS = Object.freeze([
  { key: 'netIncome', kind: 'money', cadence: 'per month', question: 'What is your monthly take-home income?' },
  { key: 'incomeHistory', kind: 'moneyList', question: 'If your income varies, list the last 3 to 6 monthly take-home amounts, separated by commas. Send "skip" if it is steady.' },
  { key: 'rent', kind: 'money', cadence: 'per month', question: 'What is your contractual rent or housing cost each month? Send 0 if you have none.' },
  { key: 'coreExpenses', kind: 'money', cadence: 'per month', question: 'What do you spend each month on food, medical, utilities, transport and school fees? Exclude rent and EMIs.' },
  { key: 'liquidReserves', kind: 'money', question: 'How much cash and bank balance could you access within a few days?' },
  { key: 'earners', kind: 'count', question: 'How many people in the household earn an income?' },
  { key: 'dependents', kind: 'count', question: 'How many people depend on that income without earning?' },
  { key: 'familyHelp', kind: 'boolean', question: 'Could family help you with money if needed? (yes/no) This is shown as a contingent buffer only.' },
  { key: 'debts', kind: 'debtList', question: 'Now your debts, one per line as: name, type, secured, balance, minimum payment, rate. Type is installment, revolving, bnpl or loanapp.' },
]);

export const AUDIT_DEBT_FIELDS = Object.freeze([
  { key: 'name', kind: 'text', question: 'What is this debt called? (e.g. "HDFC card")' },
  { key: 'type', kind: 'enum', options: DEBT_TYPES, question: 'What type is it - installment, revolving, bnpl or loanapp?' },
  { key: 'secured', kind: 'boolean', question: 'Is it secured against an asset? (yes/no)' },
  { key: 'balance', kind: 'money', question: 'What is the outstanding balance?' },
  { key: 'minPayment', kind: 'money', cadence: 'per month', question: 'What is the actual minimum payment each month?' },
  { key: 'apr', kind: 'rate', question: 'What is the rate? Send a reducing-balance APR (e.g. 42%), or "flat 24% 6 months", or "0.1% per day".' },
  { key: 'creditLimit', kind: 'money', question: 'What is the credit limit? (required for revolving debt)', when: (d) => d.type === 'revolving' },
]);

export default {
  emptyProfile, emptyDebt, normaliseDebt, buildDiagnosticInput, reviewProfile, diagnoseProfile,
  AUDIT_FIELDS, AUDIT_DEBT_FIELDS, DEBT_TYPES, DEBT_TYPE_LABELS,
};
