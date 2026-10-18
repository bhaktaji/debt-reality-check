import { describe, it, expect } from 'vitest';
import { parseExpense, classifyDescription, UNCATEGORISED } from '../../core/expense_parser.js';

describe('expense parser - the review\'s required cases (Part II B.3, D.2)', () => {
  const cases = [
    { input: '2 eggs 30', amount: 30, category: 'Groceries', essential: true, needsConfirm: true },
    { input: 'medicine 400', amount: 400, category: 'Health', essential: true },
    { input: 'electricity 1500', amount: 1500, category: 'Utilities', essential: true },
    { input: 'rent 12000', amount: 12000, category: 'Rent & Housing', essential: true },
    { input: 'school fees 3000', amount: 3000, category: 'Education & Childcare', essential: true },
    { input: 'cola 40', amount: 40, category: UNCATEGORISED, essential: null },
    { input: 'price tag 100', amount: 100, category: UNCATEGORISED, essential: null },
    { input: 'business lunch 250', amount: 250, category: UNCATEGORISED, essential: null },
    { input: 'automatic gate repair 800', amount: 800, category: UNCATEGORISED, essential: null },
    { input: 'milk 1,200', amount: 1200, category: 'Groceries', essential: true },
    { input: 'tea ₹50', amount: 50, category: UNCATEGORISED, essential: null },
  ];

  for (const c of cases) {
    it(`"${c.input}" -> ${c.amount} / ${c.category}`, () => {
      const r = parseExpense(c.input);
      expect(r).not.toBeNull();
      expect(r.amount).toBe(c.amount);
      expect(r.category).toBe(c.category);
      expect(r.isEssential).toBe(c.essential);
      if (c.needsConfirm !== undefined) expect(r.needsConfirm).toBe(c.needsConfirm);
    });
  }
});

describe('expense parser - word boundaries, not substrings (F-17)', () => {
  it('does not file "cola" under Commute because of "ola"', () => {
    expect(parseExpense('cola 40').category).toBe(UNCATEGORISED);
  });

  it('does not file "price tag" under Groceries because of "rice"', () => {
    expect(parseExpense('price tag 100').category).toBe(UNCATEGORISED);
  });

  it('does not file "business lunch" under Commute because of "bus"', () => {
    expect(parseExpense('business lunch 250').category).toBe(UNCATEGORISED);
  });

  it('does not file "automatic gate repair" under Commute because of "auto"', () => {
    expect(parseExpense('automatic gate repair 800').category).toBe(UNCATEGORISED);
  });

  it('still matches the real words', () => {
    expect(parseExpense('bus 30').category).toBe('Commute');
    expect(parseExpense('rice 500').category).toBe('Groceries');
    expect(parseExpense('auto 80').category).toBe('Commute');
    expect(parseExpense('ola 240').category).toBe('Cab / Ride-hail');
    expect(parseExpense('ola 240').isEssential).toBe(false);
  });
});

describe('expense parser - Indian amounts and shapes', () => {
  it('handles k / lakh / crore suffixes', () => {
    expect(parseExpense('rent 12k').amount).toBe(12000);
    expect(parseExpense('rent 1.5 lakh').amount).toBe(150000);
    expect(parseExpense('school 2 crore').amount).toBe(20000000);
  });

  it('handles currency symbols and commas', () => {
    expect(parseExpense('₹ 500 medicine').amount).toBe(500);
    expect(parseExpense('rs. 1,50,000 rent').amount).toBe(150000);
  });

  it('reads the LAST number as the amount when several appear', () => {
    const r = parseExpense('2 eggs 30');
    expect(r.amount).toBe(30);
    expect(r.needsConfirm).toBe(true);
  });

  it('returns null when there is no number at all (never silence, never zero)', () => {
    expect(parseExpense('hello there')).toBeNull();
    expect(parseExpense('')).toBeNull();
  });

  it('flags ambiguity when several numbers appear and the last token is not one', () => {
    expect(parseExpense('30 eggs 2 milk')).toMatchObject({ error: 'AMBIGUOUS_AMOUNT' });
  });

  it('never returns amount 0 for a malformed value', () => {
    const r = parseExpense('medicine 12abc');
    expect(r === null || r.amount !== 0).toBe(true);
  });
});

describe('classifyDescription', () => {
  it('returns Uncategorised with isEssential null so the user is asked', () => {
    expect(classifyDescription('mystery item')).toEqual({ category: UNCATEGORISED, isEssential: null });
  });

  it('marks survival costs essential', () => {
    for (const w of ['rent', 'medicine', 'electricity', 'school', 'milk', 'petrol']) {
      expect(classifyDescription(w).isEssential, w).toBe(true);
    }
  });

  it('marks habits and leisure discretionary', () => {
    for (const w of ['cigarette', 'beer', 'netflix', 'swiggy']) {
      expect(classifyDescription(w).isEssential, w).toBe(false);
    }
  });
});
