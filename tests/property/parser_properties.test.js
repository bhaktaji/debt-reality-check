import { describe, it, expect } from 'vitest';
import { parseAmount, MULT, countNumericValues } from '../../core/input.js';
import { parseExpense } from '../../core/expense_parser.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = [3, 11, 29, 101, 4242, 20261004];

/** Every plausible way a user writes the same number. */
function variants(n) {
  const grouped = n.toLocaleString('en-IN');
  const out = [String(n), grouped, `₹${grouped}`, `Rs ${grouped}`, `rs.${grouped}`, `INR ${grouped}`];
  if (n >= 1000 && n % 1000 === 0) out.push(`${n / 1000}k`, `${n / 1000}K`);
  if (n >= 100000 && n % 100000 === 0) out.push(`${n / 100000} lakh`, `${n / 100000}L`);
  return out;
}

describe('round-trip: the parser never silently mis-scales', () => {
  it('every formatted variant of a number parses back to exactly that number', () => {
    for (const seed of SEEDS) {
      const rand = rng(seed);
      for (let i = 0; i < 200; i++) {
        const n = Math.floor(rand() * 10000000);
        for (const v of variants(n)) {
          const parsed = parseAmount(v);
          expect(parsed, `"${v}" should parse to ${n}`).toBe(n);
        }
      }
    }
  });

  it('specifically catches the historical mis-scales', () => {
    expect(parseAmount('60k')).toBe(60000);
    expect(parseAmount('60k')).not.toBe(60);
    expect(parseAmount('1.5 lakh')).toBe(150000);
    expect(parseAmount('1.5 lakh')).not.toBe(1.5);
    expect(parseAmount('50,000')).toBe(50000);
    expect(parseAmount('50,000')).not.toBe(50);
    expect(parseAmount('2 lakh')).toBe(200000);
    expect(parseAmount('2 lakh')).not.toBe(2);
  });
});

describe('malformed input never becomes zero', () => {
  const JUNK = [
    '12abc', '60k5', 'abc', '', '   ', '₹', 'rs', 'lakh', 'k', '--5', '5-', '1.2.3',
    '60,00,0.0', 'k60', 'lakh 2.5', 'sixty thousand', 'null', 'NaN', 'undefined', '{}',
    '₹₹₹', '1,2,3,4,5,6.7.8', 'thousand', 'crore', '1e5', '0x10',
  ];

  it('returns null (never 0) for every junk string', () => {
    for (const j of JUNK) {
      const r = parseAmount(j);
      expect(r, `junk "${j}" must not become 0`).not.toBe(0);
      if (r !== null) {
        // The only acceptable non-null results are the genuinely numeric ones.
        expect(['1e5', '0x10']).toContain(j);
      }
    }
  });

  it('rejects a random digit string with an unknown suffix', () => {
    const rand = rng(97);
    const known = new Set(Object.keys(MULT));
    for (let i = 0; i < 300; i++) {
      const digits = String(1 + Math.floor(rand() * 99999));
      const suffix = String.fromCharCode(97 + Math.floor(rand() * 26)).repeat(1 + Math.floor(rand() * 3));
      if (known.has(suffix)) continue;
      expect(parseAmount(`${digits}${suffix}`), `${digits}${suffix}`).toBeNull();
    }
  });

  it('never turns a failed expense parse into a zero-amount expense', () => {
    const rand = rng(31337);
    const words = ['medicine', 'rent', 'milk', 'cola', 'price', 'business', 'automatic', 'school'];
    for (let i = 0; i < 300; i++) {
      const word = words[Math.floor(rand() * words.length)];
      const junk = ['abc', 'k5', '₹', '', '...', 'lakh'][Math.floor(rand() * 6)];
      const r = parseExpense(`${word} ${junk}`);
      expect(r === null || r.amount !== 0 || r.error).toBeTruthy();
      if (r && !r.error) expect(r.amount).toBeGreaterThan(0);
    }
  });
});

describe('commas, symbols and Hinglish mixes do not confuse the token counter', () => {
  it('counts numbers correctly across random mixes', () => {
    expect(countNumericValues('₹60,000')).toBe(1);
    expect(countNumericValues('Rs 60,000 per month')).toBe(1);
    expect(countNumericValues('60000, 55000, 48000')).toBe(3);
    expect(countNumericValues('1.5 lakh')).toBe(1);
    expect(countNumericValues('2 eggs 30')).toBe(2);
    expect(countNumericValues('rent 12k aur bijli 1500')).toBe(2);
    expect(countNumericValues('no numbers at all')).toBe(0);
  });

  it('is stable under repeated application (no regex lastIndex leakage)', () => {
    const text = '₹60,000 per month';
    for (let i = 0; i < 20; i++) expect(countNumericValues(text)).toBe(1);
  });
});

describe('expense parser robustness', () => {
  it('never throws on random input', () => {
    const rand = rng(808);
    const alphabet = 'abc₹0123456789 ,.kmlacrorpe/'.split('');
    for (let i = 0; i < 800; i++) {
      const len = 1 + Math.floor(rand() * 40);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      expect(() => parseExpense(s)).not.toThrow();
    }
  });

  it('always returns a non-negative amount when it returns one', () => {
    const rand = rng(909);
    const words = ['eggs', 'medicine', 'electricity', 'cola', 'rent', 'school', 'bus'];
    for (let i = 0; i < 400; i++) {
      const n = Math.floor(rand() * 100000);
      const w = words[Math.floor(rand() * words.length)];
      const r = parseExpense(`${w} ${n}`);
      if (r && !r.error) {
        expect(r.amount).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(r.amount)).toBe(true);
      }
    }
  });
});
