import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes.js';
import { diagnoseProfile } from '../../core/profile.js';

/**
 * Golden fixtures: the four household archetypes from the whitepaper (section 8) with the
 * outcomes recomputed under v2 in Part II section G.1.
 *
 * These are the numbers the review published, so any drift here is a real regression.
 */

describe('archetypes under Algorithm v2 (G.1)', () => {
  for (const a of ARCHETYPES) {
    describe(`Profile ${a.id}: ${a.name}`, () => {
      const d = diagnoseProfile(a.profile);
      const e = a.expected;

      it('matches the recomputed FOIR', () => {
        expect(Number(d.metrics.foir.toFixed(1))).toBe(e.foir);
      });

      it('matches the recomputed DCF %', () => {
        expect(Number(d.metrics.dcfPct.toFixed(1))).toBe(e.dcfPct);
      });

      it('matches the recomputed runway', () => {
        expect(Number(d.metrics.er.toFixed(2))).toBe(e.runway);
      });

      it('matches the flow tier and the final tier', () => {
        expect(d.flowTier).toBe(e.flowTier);
        expect(d.tier).toBe(e.tier);
      });

      it('names the right drivers', () => {
        expect([...d.drivers].sort()).toEqual([...e.drivers].sort());
      });

      it('uses the v2 tier-4 label', () => {
        if (e.tier === 4) expect(d.tierLabel).toBe('Acute cash-flow crisis');
      });

      it('agrees about the career-risk rule', () => {
        expect(d.career.applies).toBe(e.careerRiskApplies);
      });
    });
  }
});

describe('the specific corrections the review demanded', () => {
  it('Profile B is tier 3, not the tier 2 the shipped v1 code returned', () => {
    const d = diagnoseProfile(ARCHETYPES.find((a) => a.id === 'B').profile);
    expect(d.metrics.foir).toBeCloseTo(50.0, 6); // exactly on the cut-off, so the worse tier
    expect(d.tiers.foir).toBe(3);
    expect(d.tier).toBe(3);
  });

  it('Profile C becomes tier 3 because a 2.27-month buffer is thin (was tier 2 in v1)', () => {
    const d = diagnoseProfile(ARCHETYPES.find((a) => a.id === 'C').profile);
    expect(d.flowTier).toBe(2);
    expect(d.tier).toBe(3);
    expect(d.notes.join(' ')).toMatch(/Runway-limited/);
    expect(d.drivers).toEqual(['Runway']);
  });

  it('Profile A and D stay tier 4', () => {
    for (const id of ['A', 'D']) {
      expect(diagnoseProfile(ARCHETYPES.find((a) => a.id === id).profile).tier).toBe(4);
    }
  });

  it('family help does not rescue Profile D', () => {
    const d = diagnoseProfile(ARCHETYPES.find((a) => a.id === 'D').profile);
    expect(d.tier).toBe(4);
    expect(d.notes.join(' ')).toMatch(/contingent buffer/);
  });

  it('Profile B reports a real revolving utilisation, not a constant 71.4%', () => {
    const d = diagnoseProfile(ARCHETYPES.find((a) => a.id === 'B').profile);
    expect(d.metrics.cur).toBeCloseTo(80, 6); // 200,000 on a 250,000 limit
    expect(d.metrics.cur).not.toBeCloseTo(71.4, 1);
  });
});
