/**
 * core/plausibility.js
 * Data-quality guards (Part II C.9, task section 10).
 *
 * These functions only REPORT. They never modify, clamp, back-fill or drop user data.
 * A missing value stays missing and becomes a question, not a guess.
 *
 * Pure. No I/O.
 */

import { POLICY } from './policy.js';
import { inr } from './formatting.js';

const REVOLVING = 'revolving';
const DEBT_TYPES = ['installment', 'revolving', 'bnpl', 'loanapp'];

/**
 * @param {object} profile raw profile
 * @returns {{warnings:Array, questions:Array}}
 */
export function checkPlausibility(profile = {}) {
  const warnings = [];
  const questions = [];
  const income = Number(profile.netIncome) || 0;
  const core = Number(profile.coreExpenses) || 0;
  const rent = Number(profile.rent) || 0;
  const reserves = Number(profile.liquidReserves) || 0;
  const debts = Array.isArray(profile.debts) ? profile.debts : [];

  const totalEmi = debts.reduce((s, d) => s + (Number(d.minPayment) || 0), 0);
  const outflow = totalEmi + rent + core;

  // --- structural / missing-data questions (never inferred) -------------------
  for (const [i, d] of debts.entries()) {
    const label = d.name || `Debt ${i + 1}`;
    if (d.type == null || d.type === '') {
      questions.push({ field: `debts[${i}].type`, message: `What type is "${label}" - installment, revolving, bnpl or loanapp?` });
    } else if (!DEBT_TYPES.includes(d.type)) {
      warnings.push({ code: 'UNKNOWN_DEBT_TYPE', field: `debts[${i}].type`, message: `"${label}" has an unrecognised type "${d.type}"; it will be treated as unsecured unless you say otherwise.` });
    }
    if (d.secured === undefined || d.secured === null) {
      questions.push({ field: `debts[${i}].secured`, message: `Is "${label}" secured against an asset (yes/no)?` });
    }
    if (d.type === REVOLVING && !(Number(d.creditLimit) > 0)) {
      questions.push({ field: `debts[${i}].creditLimit`, message: `What is the credit limit on "${label}"? Without it, credit utilisation is reported as unknown.` });
    }
    if (d.apr == null && d.quote == null) {
      questions.push({ field: `debts[${i}].apr`, message: `What rate applies to "${label}" (reducing-balance APR, or a flat/daily quote)?` });
    }
    const apr = Number(d.apr);
    if (Number.isFinite(apr) && apr > POLICY.rateClarificationThresholdPct) {
      questions.push({ field: `debts[${i}].apr`, message: `The rate on "${label}" is ${apr}%. Is that per year or per month?` });
    }
  }

  if (!(income > 0)) {
    warnings.push({ code: 'NO_INCOME', field: 'netIncome', message: 'No monthly income has been entered, so ratios cannot be computed.' });
  }

  // --- implausible magnitudes -------------------------------------------------
  if (income > 0 && totalEmi > income) {
    warnings.push({
      code: 'EMI_ABOVE_INCOME',
      field: 'debts',
      message: `Total minimum payments (${inr(totalEmi)}) exceed monthly income (${inr(income)}). Check for a 10x slip or a missed income source.`,
    });
  }

  if (income > 0 && core > 0 && (core / income) * 100 < POLICY.lowCoreExpensePctOfIncome) {
    warnings.push({
      code: 'CORE_EXPENSES_LOW',
      field: 'coreExpenses',
      message: `Core living costs are ${((core / income) * 100).toFixed(1)}% of income, below the ${POLICY.lowCoreExpensePctOfIncome}% plausibility floor. This may understate survival costs.`,
    });
  }

  if (income > 0) {
    const cap = income * POLICY.singleAmountMultipleOfIncome;
    const fields = [
      ['netIncome', income],
      ['rent', rent],
      ['coreExpenses', core],
      ['liquidReserves', reserves],
      ...debts.map((d, i) => [`debts[${i}].balance`, Number(d.balance) || 0]),
      ...debts.map((d, i) => [`debts[${i}].minPayment`, Number(d.minPayment) || 0]),
    ];
    for (const [field, value] of fields) {
      if (value > cap) {
        warnings.push({
          code: 'SINGLE_AMOUNT_LARGE',
          field,
          message: `${field} is ${inr(value)}, more than ${POLICY.singleAmountMultipleOfIncome}x monthly income. Confirm it is not a 10x slip.`,
        });
      }
    }
  }

  if (outflow > 0 && reserves > outflow * 12 * POLICY.reservesYearsOfExpenses) {
    warnings.push({
      code: 'RESERVES_LARGE',
      field: 'liquidReserves',
      message: `Liquid reserves (${inr(reserves)}) exceed ${POLICY.reservesYearsOfExpenses} years of expenses. Confirm these are liquid and not a typo.`,
    });
  }

  for (const [i, d] of debts.entries()) {
    if ((Number(d.balance) || 0) > 0 && (Number(d.minPayment) || 0) > 0) {
      const monthlyInterest = ((Number(d.balance) || 0) * (Number(d.apr) || 0)) / 1200;
      if (monthlyInterest > 0 && Number(d.minPayment) <= monthlyInterest) {
        warnings.push({
          code: 'NEGATIVE_AMORTISATION',
          field: `debts[${i}].minPayment`,
          message: `The minimum on "${d.name || `Debt ${i + 1}`}" (${inr(Number(d.minPayment))}) does not cover its monthly interest (${inr(monthlyInterest)}), so the balance grows even when paid on time.`,
        });
      }
    }
  }

  return { warnings, questions };
}

export default { checkPlausibility };
