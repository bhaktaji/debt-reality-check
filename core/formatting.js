/**
 * core/formatting.js
 * Indian money / number formatting helpers shared by web, bot, CLI and export.
 * Pure. Money is handled in rupees here; storage uses integer paise (see store/).
 */

const EN_IN = 'en-IN';

/** Round to whole rupees, half away from zero, without float drift. */
function roundRupees(n) {
  if (!Number.isFinite(n)) return n;
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** Format a rupee amount with Indian digit grouping, e.g. 150000 -> "₹1,50,000". */
export function inr(amount, { paise = false, sign = false } = {}) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '₹—';
  if (!Number.isFinite(amount)) return amount > 0 ? '∞' : '-∞';
  const value = paise ? amount : roundRupees(amount);
  const opts = paise
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 };
  const body = Math.abs(value).toLocaleString(EN_IN, opts);
  const negative = value < 0;
  const plus = sign && value > 0 ? '+' : '';
  return `${negative ? '-' : plus}₹${body}`;
}

/** Format an integer-paise amount as rupees. */
export function inrFromPaise(paise) {
  if (paise === null || paise === undefined) return '₹—';
  return inr(paise / 100);
}

/** Rupees -> integer paise. */
export function toPaise(rupees) {
  if (!Number.isFinite(rupees)) return null;
  return Math.round(rupees * 100);
}

/** Integer paise -> rupees (float). */
export function fromPaise(paise) {
  if (!Number.isFinite(paise)) return null;
  return paise / 100;
}

/** Percentage with a fixed number of decimals, e.g. 62.2222 -> "62.2%". */
export function pct(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'unknown';
  if (!Number.isFinite(value)) return '∞%';
  return `${value.toFixed(decimals)}%`;
}

/** Months, e.g. 2.2727 -> "2.27 months"; 0.2 -> "0.20 months". */
export function months(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'unknown';
  if (!Number.isFinite(value)) return '∞ months';
  return `${value.toFixed(decimals)} months`;
}

/** Duration in months as "3 yr 4 mo" for payoff timelines. */
export function duration(monthsCount) {
  if (!Number.isFinite(monthsCount)) return 'n/a';
  const years = Math.floor(monthsCount / 12);
  const rest = monthsCount % 12;
  if (years === 0) return `${rest} mo`;
  if (rest === 0) return `${years} yr`;
  return `${years} yr ${rest} mo`;
}

/**
 * A month count written the way a person would say it.
 * Sub-month values become "less than a month" rather than "0.00 months".
 */
export function humanMonths(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'an unknown time';
  if (!Number.isFinite(value)) return 'a very long time';
  if (value < 1) return 'less than a month';
  if (value < 3) return `${value.toFixed(1)} months`;
  return `${Math.round(value)} months`;
}

/** Same, but phrased to sit after the word "about". */
export function aboutMonths(value) {
  const phrase = humanMonths(value);
  return phrase === 'less than a month' ? phrase : `about ${phrase}`;
}

/** Signed rupee delta, e.g. +₹543 / -₹543. */
export function inrDelta(amount) {
  return inr(amount, { sign: true });
}

/**
 * Echo-confirm helper (Part II C.9). Formats with Indian digit grouping so a user can
 * spot a 10x slip, e.g. "You entered ₹60,000 per month. Correct?".
 */
export function echoAmount(rupees, cadence = 'per month') {
  return `You entered ${inr(rupees)} ${cadence}. Correct?`;
}

/** Neutral numeric echo used for non-money fields (counts, months). */
export function count(n, singular, plural = `${singular}s`) {
  const value = Number(n);
  if (!Number.isFinite(value)) return `unknown ${plural}`;
  return `${value} ${value === 1 ? singular : plural}`;
}

export default { inr, inrFromPaise, toPaise, fromPaise, pct, months, duration, humanMonths, aboutMonths, inrDelta, echoAmount, count };
