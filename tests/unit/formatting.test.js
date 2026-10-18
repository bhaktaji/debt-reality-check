import { describe, it, expect } from 'vitest';
import { inr, inrFromPaise, toPaise, fromPaise, pct, months, duration, echoAmount } from '../../core/formatting.js';

describe('Indian money formatting (en-IN)', () => {
  it('groups digits the Indian way', () => {
    expect(inr(60000)).toBe('₹60,000');
    expect(inr(150000)).toBe('₹1,50,000');
    expect(inr(20000000)).toBe('₹2,00,00,000');
    expect(inr(100)).toBe('₹100');
    expect(inr(0)).toBe('₹0');
  });

  it('handles negatives and signs', () => {
    expect(inr(-5000)).toBe('-₹5,000');
    expect(inr(5000, { sign: true })).toBe('+₹5,000');
  });

  it('shows an em dash for missing values rather than a fake zero', () => {
    expect(inr(null)).toBe('₹—');
    expect(inr(undefined)).toBe('₹—');
    expect(inr(NaN)).toBe('₹—');
  });
});

describe('paise conversions (storage uses integer paise)', () => {
  it('round-trips rupees to paise', () => {
    expect(toPaise(60000)).toBe(6000000);
    expect(toPaise(1234.56)).toBe(123456);
    expect(fromPaise(123456)).toBe(1234.56);
    expect(inrFromPaise(6000000)).toBe('₹60,000');
  });

  it('rounds to the nearest paisa', () => {
    expect(toPaise(10.005)).toBe(1001);
    expect(toPaise(10.004)).toBe(1000);
  });

  it('returns null for a non-finite amount instead of zero', () => {
    expect(toPaise(undefined)).toBeNull();
    expect(toPaise('abc')).toBeNull();
  });
});

describe('percent, months and duration', () => {
  it('formats percentages', () => {
    expect(pct(62.2222)).toBe('62.2%');
    expect(pct(50)).toBe('50.0%');
    expect(pct(null)).toBe('unknown');
  });

  it('formats months', () => {
    expect(months(2.2727)).toBe('2.27 months');
    expect(months(0.2)).toBe('0.20 months');
    expect(months(Infinity)).toBe('∞ months');
  });

  it('formats a payoff duration', () => {
    expect(duration(7)).toBe('7 mo');
    expect(duration(12)).toBe('1 yr');
    expect(duration(40)).toBe('3 yr 4 mo');
  });
});

describe('echo confirmation', () => {
  it('restates the parsed amount so a 10x slip is visible', () => {
    expect(echoAmount(60000)).toBe('You entered ₹60,000 per month. Correct?');
    expect(echoAmount(150000)).toContain('₹1,50,000');
  });
});
