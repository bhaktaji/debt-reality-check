/**
 * store/mappers.js
 * Convert between stored rows (integer paise) and the core profile shape (rupees).
 * One place to change if the schema moves, so no surface hand-rolls the conversion.
 */

import { rupeesToPaise, paiseToRupees } from './db.js';

/** Stored user row + debt rows -> core profile (rupees). */
export function profileFromStore(userRow, debtRows = []) {
  if (!userRow) return null;
  return {
    netIncome: paiseToRupees(userRow.net_income_paise),
    incomeHistory: JSON.parse(userRow.income_history_json || '[]'),
    rent: paiseToRupees(userRow.rent_paise) ?? 0,
    coreExpenses: paiseToRupees(userRow.core_expenses_paise) ?? 0,
    liquidReserves: paiseToRupees(userRow.liquid_reserves_paise) ?? 0,
    earners: userRow.earners ?? 1,
    dependents: userRow.dependents ?? 0,
    familyHelp: userRow.family_help === 1,
    currency: userRow.currency || 'INR',
    debts: debtRows.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      secured: d.secured,
      balance: d.balance,
      minPayment: d.minPayment,
      apr: d.apr,
      creditLimit: d.creditLimit,
      quote: d.quote,
    })),
  };
}

/** Core profile -> stored user columns (paise / json). */
export function fieldsFromProfile(profile = {}) {
  return {
    net_income_paise: rupeesToPaise(profile.netIncome),
    core_expenses_paise: rupeesToPaise(profile.coreExpenses),
    rent_paise: rupeesToPaise(profile.rent),
    liquid_reserves_paise: rupeesToPaise(profile.liquidReserves),
    earners: profile.earners ?? null,
    dependents: profile.dependents ?? null,
    family_help: profile.familyHelp ? 1 : 0,
    income_history_json: JSON.stringify(Array.isArray(profile.incomeHistory) ? profile.incomeHistory : []),
    currency: profile.currency || 'INR',
  };
}

export default { profileFromStore, fieldsFromProfile };
