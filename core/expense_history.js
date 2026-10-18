/**
 * core/expense_history.js
 * Turns the expense log into something the audit actually uses (F-18, task section 12).
 *
 * Produces: today's summary, a 30-day summary, a category breakdown, essential vs
 * discretionary split, recurring-spend detection and a core-cost cross-check.
 *
 * Essential spending is NEVER presented as a cut target.
 * Pure: `now` is passed in, the core never reads the clock.
 */

import { UNCATEGORISED } from './expense_parser.js';
import { inr } from './formatting.js';

/** Categories that are already counted in rent or in debt service, not in coreExpenses. */
const NOT_IN_CORE = new Set(['Rent & Housing', 'Debt Service (EMI)']);

/** Local-time YYYY-MM-DD key (fixes the UTC-vs-local bug, F-19). */
export function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(String(value).replace(' ', 'T'));
}

/**
 * @param {Array<{amount:number, category:string, isEssential:(boolean|null), createdAt:(string|number|Date), description?:string}>} expenses
 * @param {{now:(Date|string|number), days?:number}} options
 */
export function summariseExpenses(expenses = [], options = {}) {
  const now = toDate(options.now ?? new Date());
  const days = options.days ?? 30;
  const todayKey = localDateKey(now);
  const windowStart = new Date(now.getTime());
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (days - 1));

  const rows = expenses
    .map((e) => ({ ...e, _date: toDate(e.createdAt), amount: Number(e.amount) || 0 }))
    .filter((e) => !Number.isNaN(e._date.getTime()));

  const inWindow = rows.filter((e) => e._date >= windowStart && e._date <= now);

  const sum = (list) => list.reduce((s, e) => s + e.amount, 0);

  const byCategory = {};
  for (const e of inWindow) {
    const cat = e.category || UNCATEGORISED;
    if (!byCategory[cat]) byCategory[cat] = { category: cat, total: 0, count: 0, essential: e.isEssential === true, uncategorised: e.isEssential == null };
    byCategory[cat].total += e.amount;
    byCategory[cat].count += 1;
  }

  const essentialRows = inWindow.filter((e) => e.isEssential === true);
  const discretionaryRows = inWindow.filter((e) => e.isEssential === false);
  const uncategorisedRows = inWindow.filter((e) => e.isEssential == null);

  const todayRows = rows.filter((e) => localDateKey(e._date) === todayKey);

  // Recurring = a category seen in 3 or more separate days in the window.
  const daysByCategory = {};
  for (const e of inWindow) {
    const cat = e.category || UNCATEGORISED;
    (daysByCategory[cat] ||= new Set()).add(localDateKey(e._date));
  }
  const recurring = Object.entries(daysByCategory)
    .filter(([, set]) => set.size >= 3)
    .map(([category]) => ({
      category,
      daysSeen: daysByCategory[category].size,
      total: byCategory[category]?.total ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Pre-fill for coreExpenses: essentials excluding rent and EMIs.
  const prefillCore = essentialRows
    .filter((e) => !NOT_IN_CORE.has(e.category))
    .reduce((s, e) => s + e.amount, 0);

  return {
    windowDays: days,
    today: { total: sum(todayRows), count: todayRows.length, rows: todayRows },
    last30: { total: sum(inWindow), count: inWindow.length },
    byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    essential: { total: sum(essentialRows), count: essentialRows.length },
    discretionary: { total: sum(discretionaryRows), count: discretionaryRows.length },
    uncategorised: { total: sum(uncategorisedRows), count: uncategorisedRows.length },
    recurring,
    prefillCore,
    // Discretionary spend may be reviewed. Essential spend is never listed here.
    discretionaryByCategory: Object.values(
      discretionaryRows.reduce((acc, e) => {
        const cat = e.category || UNCATEGORISED;
        acc[cat] ||= { category: cat, total: 0, count: 0 };
        acc[cat].total += e.amount;
        acc[cat].count += 1;
        return acc;
      }, {}),
    ).sort((a, b) => b.total - a.total),
    cutCandidates: discretionaryRows
      .map((e) => ({ description: e.description ?? null, amount: e.amount, category: e.category }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
  };
}

/**
 * Cross-check a typed coreExpenses figure against the last 30 days of logs.
 * A mismatch is reported, never silently applied.
 */
export function crossCheckCoreCosts(enteredCore, summary) {
  const observed = summary?.prefillCore ?? 0;
  const entered = Number(enteredCore) || 0;
  if (observed <= 0) {
    return { observed, entered, delta: null, message: 'Not enough essential spending logged in the last 30 days to cross-check core costs.' };
  }
  const delta = entered - observed;
  const pctDiff = observed > 0 ? (delta / observed) * 100 : 0;
  const material = Math.abs(pctDiff) >= 30;
  return {
    observed,
    entered,
    delta,
    pctDiff,
    material,
    message: material
      ? `Your 30-day essential log (excluding rent and EMIs) is about ${inr(observed)}, but core costs entered are ${inr(entered)}. Check which is right.`
      : `Core costs entered (${inr(entered)}) are broadly consistent with the 30-day essential log (${inr(observed)}).`,
  };
}

/**
 * Essential categories are never cut targets; discretionary ones may be reviewed.
 * Returns an `essentialNote` only - the summary already carries `discretionaryByCategory`
 * and `cutCandidates`, so this must not shadow those keys.
 */
export function reviewTargets(summary) {
  return {
    essentialNote:
      'Essential spending (housing, debt service, health, utilities, education, groceries, commute) is not a cut target.',
    discretionaryCandidates: summary?.cutCandidates ?? [],
  };
}

export default { summariseExpenses, crossCheckCoreCosts, reviewTargets, localDateKey };
