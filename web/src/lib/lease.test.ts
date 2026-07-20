import { test, expect, describe } from 'bun:test';
import { SLA_LEASEHOLD, leaseFactor, leaseAdjustment } from './lease';

describe('SLA_LEASEHOLD table', () => {
  test('covers whole years 0..99', () => {
    expect(SLA_LEASEHOLD.length).toBe(100);
    expect(SLA_LEASEHOLD[0]).toBe(0);
  });
  test('matches the published SLA anchor values', () => {
    expect(SLA_LEASEHOLD[99]).toBe(96.0);
    expect(SLA_LEASEHOLD[60]).toBe(80.0);
    expect(SLA_LEASEHOLD[30]).toBe(60.0);
    expect(SLA_LEASEHOLD[5]).toBe(17.1);
  });
  test('is monotonically increasing (value never rises as lease shortens)', () => {
    for (let i = 1; i < SLA_LEASEHOLD.length; i++) {
      expect(SLA_LEASEHOLD[i]).toBeGreaterThan(SLA_LEASEHOLD[i - 1]);
    }
  });
});

describe('leaseFactor', () => {
  test('returns the table value on whole years', () => {
    expect(leaseFactor(99)).toBe(96.0);
    expect(leaseFactor(60)).toBe(80.0);
  });
  test('interpolates linearly between years', () => {
    // between 60 (80.0) and 61 (80.6): halfway is 80.3
    expect(leaseFactor(60.5)).toBeCloseTo(80.3, 6);
  });
  test('clamps out-of-range inputs to [0, 99]', () => {
    expect(leaseFactor(-10)).toBe(0);
    expect(leaseFactor(150)).toBe(96.0);
  });
});

describe('leaseAdjustment', () => {
  test('same lease as the comps is a no-op', () => {
    const a = leaseAdjustment(95, 95);
    expect(a.known).toBe(true);
    expect(a.factor).toBe(1);
    expect(a.pct).toBe(0);
  });

  test('a longer lease than the comps lifts the estimate', () => {
    const a = leaseAdjustment(99, 95);
    expect(a.factor).toBeGreaterThan(1);
    expect(a.pct).toBeCloseTo((leaseFactor(99) / leaseFactor(95) - 1) * 100, 10);
  });

  test('a much shorter lease meaningfully discounts the estimate', () => {
    const a = leaseAdjustment(40, 95);
    expect(a.factor).toBeLessThan(1);
    expect(a.pct).toBeLessThan(-20); // ~-28%
  });

  test('scaling a PSF by the factor round-trips against the table ratio', () => {
    const psf = 650;
    const a = leaseAdjustment(60, 95);
    expect(psf * a.factor).toBeCloseTo((psf * leaseFactor(60)) / leaseFactor(95), 6);
  });

  test('missing or non-positive lease -> not known, factor 1 (UI shows n/a)', () => {
    expect(leaseAdjustment(0, 95)).toEqual({ factor: 1, pct: 0, known: false });
    expect(leaseAdjustment(60, 0)).toEqual({ factor: 1, pct: 0, known: false });
  });
});
