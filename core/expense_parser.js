/**
 * core/expense_parser.js  (v2)
 * Word-boundary expense categorisation. Unknown spend is "Uncategorised" with
 * isEssential = null, so the caller asks the user instead of silently labelling a
 * survival cost a "cut target" (Part II D.2 / F-17).
 *
 * Pure. No I/O.
 */

import { parseAmount } from './input.js';

/**
 * Ordered rules. FIRST match wins, so put the most specific / most essential first.
 * Every pattern uses \b word boundaries - never substring matching.
 */
export const RULES = Object.freeze([
  { cat: 'Rent & Housing', essential: true, re: /\b(rent|maintenance|society|landlord)\b/ },
  { cat: 'Debt Service (EMI)', essential: true, re: /\b(emi|emis|instalment|installment|instalments|loan|loans)\b/ },
  { cat: 'Health', essential: true, re: /\b(medicine|medicines|pharmacy|medical|doctor|clinic|hospital|tablet|tablets)\b/ },
  { cat: 'Utilities', essential: true, re: /\b(electricity|bijli|water|gas|lpg|cylinder|recharge|broadband|wifi|internet|dth|cable)\b/ },
  { cat: 'Education & Childcare', essential: true, re: /\b(school|tuition|daycare|creche|college|books|stationery)\b/ },
  { cat: 'Groceries', essential: true, re: /\b(egg|eggs|milk|bread|dal|rice|vegetable|vegetables|sabzi|oil|ration|flour|atta|sugar|salt|chai|masala)\b/ },
  { cat: 'Commute', essential: true, re: /\b(auto|metro|bus|petrol|diesel|train|railway|toll|parking)\b/ },
  { cat: 'Cab / Ride-hail', essential: false, re: /\b(cab|cabs|uber|ola|rapido|rickshaw)\b/ },
  { cat: 'Habit / Review', essential: false, re: /\b(cigarette|cigarettes|sutta|beer|alcohol|wine|vape|tobacco|paan|gutkha)\b/ },
  { cat: 'Dining / Leisure', essential: false, re: /\b(swiggy|zomato|cafe|coffee|restaurant|movie|movies|netflix|prime|hotstar|party|outing)\b/ },
  { cat: 'Household', essential: true, re: /\b(soap|detergent|shampoo|cleaner|cleaning|utensil|broom|plumber|electrician)\b/ },
  { cat: 'Clothing', essential: false, re: /\b(clothes|clothing|shirt|shirts|saree|dress|shoes|chappal)\b/ },
]);

export const CATEGORIES = Object.freeze(RULES.map((r) => r.cat));
export const UNCATEGORISED = 'Uncategorised';

/** Classify a free-text description. Returns {category, isEssential}. */
export function classifyDescription(description) {
  const text = String(description ?? '').toLowerCase();
  for (const rule of RULES) {
    if (rule.re.test(text)) return { category: rule.cat, isEssential: rule.essential };
  }
  return { category: UNCATEGORISED, isEssential: null };
}

/**
 * Parse an expense message.
 *
 * @returns {null}
 *   when no number is present at all (the caller replies with HELP, not silence);
 *   {error:'AMBIGUOUS_AMOUNT'} when several numbers appear and the last token is not one;
 *   otherwise {amount, description, category, isEssential, needsConfirm}.
 */
export function parseExpense(text) {
  if (text == null) return null;

  // "₹ 500" / "rs. 500" -> "500";  "1.5 lakh" -> "1.5lakh";  "2 crore" -> "2crore"
  const t = String(text)
    .trim()
    .toLowerCase()
    .replace(/(₹|rs\.?|inr)\s*(?=\d)/g, '')
    .replace(/(\d)\s+(k|l|lac|lakhs?|cr|crores?)\b/g, '$1$2');

  const tokens = t.split(/\s+/).filter(Boolean);
  const numeric = tokens.map((w, i) => (parseAmount(w) !== null ? i : -1)).filter((i) => i >= 0);

  if (numeric.length === 0) return null;

  // One number -> that is the amount. Several -> the LAST token must be the amount
  // ("2 eggs 30" is Rs 30, not Rs 2).
  const last = tokens.length - 1;
  const idx = numeric.length === 1 ? numeric[0] : numeric.includes(last) ? last : -1;
  if (idx < 0) return { error: 'AMBIGUOUS_AMOUNT' };

  const amount = parseAmount(tokens[idx]);
  if (amount === null) return { error: 'AMBIGUOUS_AMOUNT' };

  const description = tokens.filter((_, i) => i !== idx).join(' ');
  const { category, isEssential } = classifyDescription(description);

  return {
    amount,
    description,
    category,
    isEssential,
    // Several numbers in the message: confirm the amount with the user (10x slips).
    needsConfirm: numeric.length > 1,
  };
}

export default { parseExpense, classifyDescription, RULES, CATEGORIES, UNCATEGORISED };
