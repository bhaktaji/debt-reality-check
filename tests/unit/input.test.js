import { describe, it, expect } from 'vitest';
import {
  parseAmount, parseAmountDetailed, parseSingleAmount, parseRateSpec,
  countNumericValues, detectCadence, parseYesNo, parseEssential,
} from '../../core/input.js';

describe('parseAmount - Indian amount parsing (F-16)', () => {
  it('parses the forms a real user types', () => {
    expect(parseAmount('₹60,000')).toBe(60000);
    expect(parseAmount('Rs 60,000')).toBe(60000);
    expect(parseAmount('rs.60000')).toBe(60000);
    expect(parseAmount('INR 60000')).toBe(60000);
    expect(parseAmount('60000')).toBe(60000);
    expect(parseAmount('60k')).toBe(60000);
    expect(parseAmount('60K')).toBe(60000);
    expect(parseAmount('1.5 lakh')).toBe(150000);
    expect(parseAmount('1.5lakh')).toBe(150000);
    expect(parseAmount('2 lakh')).toBe(200000);
    expect(parseAmount('2 crore')).toBe(20000000);
    expect(parseAmount('1 cr')).toBe(10000000);
    expect(parseAmount('50,000')).toBe(50000);
    expect(parseAmount('1,50,000')).toBe(150000);
    expect(parseAmount('1.5L')).toBe(150000);
    expect(parseAmount('2 thousand')).toBe(2000);
  });

  it('reads a trailing cadence without swallowing it into the number', () => {
    expect(parseAmount('60,000/month')).toBe(60000);
    expect(parseAmount('60,000 per month')).toBe(60000);
    expect(parseAmount('7,20,000 per year')).toBe(720000);
    expect(detectCadence('7,20,000 per year')).toBe('year');
    expect(detectCadence('60,000/month')).toBe('month');
    expect(detectCadence('60000')).toBe(null);
  });

  it('never silently converts junk into zero', () => {
    for (const bad of ['12abc', 'abc', '', '   ', 'sixty thousand', '60k5', '1.2.3', '--', '₹', 'lakh', '1,2,3,4,5.5.5']) {
      expect(parseAmount(bad), `expected null for ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('rejects negatives and unknown suffixes explicitly', () => {
    expect(parseAmountDetailed('-500')).toMatchObject({ ok: false, error: 'NEGATIVE' });
    expect(parseAmountDetailed('12xyz')).toMatchObject({ ok: false, error: 'UNKNOWN_SUFFIX' });
    expect(parseAmountDetailed('12abc').suffix).toBe('abc');
  });

  it('accepts zero as a real value (rent 0 is legitimate)', () => {
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('₹0')).toBe(0);
  });
});

describe('comma handling: separator vs thousands grouping', () => {
  it('treats a comma inside a number as a thousands separator', () => {
    expect(parseSingleAmount('3,500')).toMatchObject({ ok: true, value: 3500 });
    expect(parseSingleAmount('1,00,000')).toMatchObject({ ok: true, value: 100000 });
    expect(countNumericValues('3,500')).toBe(1);
  });

  it('treats a comma followed by whitespace as a list separator', () => {
    expect(countNumericValues('60000, 55000, 48000')).toBe(3);
    expect(parseSingleAmount('60000, 55000')).toMatchObject({ ok: false, error: 'AMBIGUOUS_AMOUNT' });
  });
});

describe('parseSingleAmount - ambiguity guard', () => {
  it('refuses several numbers unless explicitly allowed', () => {
    expect(parseSingleAmount('2 eggs 30')).toMatchObject({ ok: false, error: 'AMBIGUOUS_AMOUNT' });
    expect(parseSingleAmount('2 eggs 30', { allowMultiple: true })).toMatchObject({ ok: true, value: 2 });
  });

  it('reads "1.5 lakh" as one value', () => {
    expect(parseSingleAmount('1.5 lakh')).toMatchObject({ ok: true, value: 150000 });
  });

  it('reports malformed rather than returning zero', () => {
    const r = parseSingleAmount('no numbers here');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('MALFORMED');
  });
});

describe('parseRateSpec', () => {
  it('reads a plain APR', () => {
    expect(parseRateSpec('42')).toEqual({ apr: 42 });
    expect(parseRateSpec('42%')).toEqual({ apr: 42 });
    expect(parseRateSpec('9.5 percent')).toEqual({ apr: 9.5 });
  });

  it('reads a flat quote with a term', () => {
    expect(parseRateSpec('flat 24 6')).toEqual({ quote: { basis: 'flat', rate: 24, months: 6 } });
    expect(parseRateSpec('24% flat over 6 months')).toMatchObject({ quote: { basis: 'flat', rate: 24, months: 6 } });
  });

  it('reads a daily quote', () => {
    expect(parseRateSpec('0.1 per day')).toEqual({ quote: { basis: 'daily', rate: 0.1 } });
    expect(parseRateSpec('0.1% daily')).toEqual({ quote: { basis: 'daily', rate: 0.1 } });
  });

  it('refuses a flat rate with no term instead of guessing one', () => {
    expect(parseRateSpec('flat 24')).toBeNull();
    expect(parseRateSpec('about right')).toBeNull();
  });
});

describe('parseYesNo / parseEssential', () => {
  it('understands the answers users actually send', () => {
    for (const y of ['y', 'yes', 'Y', 'correct', 'ok', 'haan', 'sahi']) expect(parseYesNo(y)).toBe(true);
    for (const n of ['n', 'no', 'wrong', 'nahi']) expect(parseYesNo(n)).toBe(false);
    expect(parseYesNo('maybe')).toBe(null);
  });

  it('classifies essential vs discretionary', () => {
    expect(parseEssential('E')).toBe(true);
    expect(parseEssential('essential')).toBe(true);
    expect(parseEssential('D')).toBe(false);
    expect(parseEssential('discretionary')).toBe(false);
    expect(parseEssential('unsure')).toBe(null);
  });
});
