/**
 * core/input.js  (v2)
 * Strict amount and rate parsing.
 *
 * Design rule (Part II C.1/C.9): never guess. An unknown suffix, stray text or
 * ambiguous multi-number string returns null / an explicit error. A failed parse is
 * NEVER silently converted to zero.
 *
 * Pure. No I/O.
 */

import { inr as formatInr } from './formatting.js';

/** Indian / common money suffixes. */
export const MULT = Object.freeze({
  k: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  l: 1e5,
  lac: 1e5,
  lacs: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
});

/** Currency markers stripped before parsing. */
const CURRENCY_RE = /₹|inr|rs\.?/g;
/** Trailing cadence words, reported back to the caller rather than ignored. */
const CADENCE_RE = /\b(per\s+month|\/\s*month|p\.?m\.?|monthly|per\s+monthly|per\s+year|\/\s*year|p\.?a\.?|annually|per\s+annum|yearly|\/\s*mo|\/\s*yr)\b\.?/gi;

const YEARLY_WORDS = /^(per\s+year|\/\s*year|p\.?a\.?|annually|per\s+annum|yearly|\/\s*yr)$/i;

/**
 * Detect a cadence word in raw text. Returns 'year', 'month' or null.
 * Used to answer "per year or per month?" without inventing a value.
 */
export function detectCadence(raw) {
  if (raw == null) return null;
  const matches = String(raw).toLowerCase().match(CADENCE_RE);
  if (!matches) return null;
  const last = matches[matches.length - 1].trim().replace(/\.$/, '');
  return YEARLY_WORDS.test(last) ? 'year' : 'month';
}

/**
 * Parse a single amount token/string to a number of rupees.
 * Returns a finite, non-negative number, or null when the input cannot be trusted.
 *
 * Accepts: "₹60,000", "Rs 60,000", "60000", "60k", "1.5 lakh", "2 crore",
 *          "1,50,000", "60,000/month", "1.5L".
 * Rejects: "12abc", "abc", "", "60k5", "60,00,0.0.0", "1.2.3", "sixty thousand".
 */
export function parseAmount(raw) {
  const detail = parseAmountDetailed(raw);
  return detail.ok ? detail.value : null;
}

/**
 * Same as parseAmount but explains the failure. Never returns a silent zero.
 * @returns {{ok:true, value:number, cadence:('year'|'month'|null), suffix:string|null}
 *          |{ok:false, error:string, raw:string}}
 */
export function parseAmountDetailed(raw) {
  if (raw === null || raw === undefined) {
    return { ok: false, error: 'EMPTY', raw: raw };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, error: 'NOT_FINITE', raw: raw };
    if (raw < 0) return { ok: false, error: 'NEGATIVE', raw: raw };
    return { ok: true, value: raw, cadence: null, suffix: null };
  }

  const original = String(raw);
  const cadence = detectCadence(original);

  let cleaned = original
    .toLowerCase()
    .replace(CADENCE_RE, ' ') // cadence words
    .replace(CURRENCY_RE, '') // currency markers
    .replace(/[ _]/g, '') // underscores and spaces
    .trim();

  if (cleaned === '') return { ok: false, error: 'EMPTY', raw: original };

  // Commas are only accepted as digit grouping, in either the Indian or the Western
  // pattern. Anything else ("60,00,0.0", "1,2,3,4,5") is malformed and must not be
  // silently re-scaled into a plausible-looking number.
  if (cleaned.includes(',')) {
    const indian = /^\d{1,2}(?:,\d{2})*,\d{3}$/;
    const western = /^\d{1,3}(?:,\d{3})+$/;
    if (!indian.test(cleaned) && !western.test(cleaned)) {
      return { ok: false, error: 'MALFORMED', raw: original };
    }
    cleaned = cleaned.replace(/,/g, '');
  }

  // A single optional sign, digits with optional single decimal point, optional alpha suffix.
  const m = cleaned.match(/^([+-]?)(\d+(?:\.\d+)?)([a-z]*)$/);
  if (!m) return { ok: false, error: 'MALFORMED', raw: original };

  const [, sign, digits, suffix] = m;
  const n = Number.parseFloat(digits);
  if (!Number.isFinite(n)) return { ok: false, error: 'MALFORMED', raw: original };
  if (sign === '-') return { ok: false, error: 'NEGATIVE', raw: original };

  if (!suffix) return { ok: true, value: n, cadence, suffix: null };

  const mult = MULT[suffix];
  if (mult === undefined) return { ok: false, error: 'UNKNOWN_SUFFIX', raw: original, suffix };

  return { ok: true, value: n * mult, cadence, suffix };
}

/** Parse a percentage, e.g. "24%", "3.5 %", "0.1%". Returns a number or null. */
export function parsePercent(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).toLowerCase().replace(/%|percent|pct|pa/gi, '').replace(/[, _]/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tokenise a free-text answer.
 *
 * A comma is a thousands separator when it sits inside a number ("3,500", "1,00,000")
 * and a list separator when it is followed by whitespace ("60000, 55000"). Getting this
 * wrong is exactly the class of silent mis-scale the review flagged, so it is explicit.
 */
export function tokeniseAmounts(text) {
  if (text == null) return [];
  return String(text)
    .toLowerCase()
    .replace(CADENCE_RE, ' ')
    .replace(CURRENCY_RE, '')
    .replace(/,\s+/g, ' ') // list separator: comma followed by whitespace
    .replace(/[;\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Count distinct numeric values in a free-text string.
 * Used by the bot to refuse ambiguous replies (Part II C.9) unless confirmed.
 */
export function countNumericValues(text) {
  return tokeniseAmounts(text).filter((t) => parseAmount(t) !== null).length;
}

/**
 * Strict single-value parser for audit answers. Refuses a reply that contains more
 * than one number unless `{ allowMultiple: true }` is passed (echo-confirm flow).
 * @returns {{ok:true, value:number}|{ok:false, error:string}}
 */
export function parseSingleAmount(raw, { allowMultiple = false } = {}) {
  // First try the whole string, so a suffixed value written with a space ("1.5 lakh")
  // is read as ONE number rather than as "1.5" followed by junk. A multi-number string
  // ("60000, 55000") fails this because of the comma-grouping validation in parseAmount.
  const whole = parseAmount(raw);
  if (whole !== null) return { ok: true, value: whole };

  const tokens = tokeniseAmounts(raw);
  const values = tokens.map(parseAmount).filter((v) => v !== null);
  if (values.length === 0) return { ok: false, error: 'MALFORMED' };
  if (values.length > 1 && !allowMultiple) return { ok: false, error: 'AMBIGUOUS_AMOUNT' };
  return { ok: true, value: values[0] };
}

/**
 * Parse a rate answer into either a reducing-balance APR or a quote the engine can
 * normalise. Never guesses a basis: an unrecognised shape returns null.
 *
 * Accepts: "42", "42%", "42 percent"
 *          "flat 24 6" / "flat 24% over 6 months" / "24 flat 6 months"  -> flat quote
 *          "0.1 per day" / "0.1% daily" / "daily 0.1"                   -> daily quote
 *
 * @returns {{apr:number}|{quote:{basis:'flat'|'daily', rate:number, months?:number, fee?:number}}|null}
 */
export function parseRateSpec(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;

  const num = (s) => {
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  // daily
  const daily = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|pct)?\s*(?:per\s*day|daily|\/\s*day|a\s*day)/);
  if (daily) {
    const rate = num(daily[1]);
    return rate === null ? null : { quote: { basis: 'daily', rate } };
  }

  // flat: needs a rate and a term in months, e.g. "flat 24 6" or "24% flat over 6 months"
  if (/\bflat\b/.test(text)) {
    const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => ({
      value: Number(m[1]),
      tail: text.slice(m.index + m[0].length),
    }));
    if (numbers.length < 2) return null; // a flat quote with no term is refused, never guessed

    const rate = numbers[0].value;
    const withUnit = numbers.slice(1).find((n) => /^\s*(?:months?|mos?|m)\b/.test(n.tail));
    const months = withUnit ? withUnit.value : numbers[1].value;
    if (!Number.isFinite(rate) || !Number.isFinite(months) || months <= 0) return null;

    const quote = { basis: 'flat', rate, months };
    const feeMatch = text.match(/fee\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:%|percent|pct)/);
    if (feeMatch) quote.feePct = num(feeMatch[1]);
    return { quote };
  }

  // plain APR
  const plain = text.match(/^(\d+(?:\.\d+)?)\s*(?:%|percent|pct|pa|p\.a\.)?$/);
  if (plain) {
    const apr = num(plain[1]);
    return apr === null ? null : { apr };
  }

  return null;
}

/** Echo-confirm helper, re-exported so callers have one import for input handling. */
export const inr = (n) => formatInr(n);

/** True when a raw string is a bare affirmative/negative answer. */
export function parseYesNo(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (['y', 'yes', 'yeah', 'yep', 'correct', 'right', 'ok', 'okay', 'haan', 'han', 'sahi', 'true'].includes(s)) return true;
  if (['n', 'no', 'nope', 'wrong', 'incorrect', 'nah', 'nahi', 'na', 'false'].includes(s)) return false;
  return null;
}

/** True when a raw string answers the essential/discretionary question. */
export function parseEssential(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (['e', 'essential', 'need', 'necessary', 'must', 'zaroori'].includes(s)) return true;
  if (['d', 'discretionary', 'want', 'optional', 'luxury', 'non-essential', 'nonessential'].includes(s)) return false;
  return null;
}

export default { parseAmount, parseAmountDetailed, parseSingleAmount, tokeniseAmounts, parsePercent, parseRateSpec, countNumericValues, detectCadence, parseYesNo, parseEssential, inr, MULT };
