import { test, expect, describe } from 'bun:test';
import { valuate, med, quantile, confidence } from './valuation';
import type { CompRow, NearbyRow } from './hyparquetCore';

const comp = (o: Partial<CompRow> = {}): CompRow => ({
  month: '2026-03',
  address: '1 TEST ST',
  street_name: 'TEST ST',
  storey_range: '07 TO 09',
  slo: 7,
  area: 1000,
  lease: 80,
  price: 600000,
  psf: 600,
  lat: 1.3,
  lng: 103.8,
  ...o,
});
const row = (o: Partial<CompRow> = {}): NearbyRow => ({ ...comp(o), dist: 0, match: true });

test('med and quantile', () => {
  expect(med([])).toBe(0);
  expect(med([3, 1, 2])).toBe(2);
  expect(med([4, 1, 2, 3])).toBe(2.5);
  expect(quantile([], 0.5)).toBe(0);
  expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
  expect(quantile([10, 20], 0.5)).toBe(15);
});

describe('valuate', () => {
  test('estimate is the median comp PSF times area', () => {
    const comps = [500, 550, 600, 650, 700].map((psf) => comp({ psf }));
    const v = valuate(
      {
        comps,
        nearby: comps.map((c) => ({ ...c, dist: 0, match: true })),
        scope: 'near',
        pool: [],
      },
      { storey: '', area: 1000, lease: 80 },
    );
    expect(v.n).toBe(5);
    expect(v.medPsf).toBe(600);
    expect(v.estimate).toBe(600000);
    expect(v.low).toBeLessThan(v.estimate);
    expect(v.high).toBeGreaterThan(v.estimate);
    expect(v.useStorey).toBe(false);
  });

  test('shifts comps to the chosen storey along the fitted per-floor premium', () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      row({ slo: 1 + 3 * i, psf: 600 + 5 * 3 * i }),
    );
    const comps = [comp({ slo: 1, psf: 600 })];
    const v = valuate(
      { comps, nearby: pool, scope: 'near', pool: [] },
      { storey: '10 TO 12', area: 1000, lease: 80 },
    );
    expect(v.slope).toBeCloseTo(5, 6);
    expect(v.useStorey).toBe(true);
    expect(v.medPsf).toBeCloseTo(645, 6);
  });

  test('shifts comps to the flat lease at the town-wide per-year premium', () => {
    // Town: PSF rises $6 per year of lease. Comps are 10 years longer than the flat.
    const pool = Array.from({ length: 20 }, (_, i) => ({
      slo: 4,
      lease: 50 + 2 * i,
      psf: 300 + 12 * i,
    }));
    const comps = [comp({ lease: 70, psf: 600 }), comp({ lease: 70, psf: 620 })];
    const v = valuate(
      { comps, nearby: [], scope: 'lease', pool },
      { storey: '', area: 1000, lease: 60 },
    );
    expect(v.leaseCoef).toBeCloseTo(6, 6);
    expect(v.medPsf).toBeCloseTo(550, 6); // 610 - 6 × 10
    expect(v.leaseAdjPct).toBeCloseTo((550 / 610 - 1) * 100, 6);
    // Unknown lease: no lease adjustment.
    const u = valuate(
      { comps, nearby: [], scope: 'town', pool },
      { storey: '', area: 1000, lease: 0 },
    );
    expect(u.leaseCoef).toBe(0);
    expect(u.medPsf).toBe(610);
  });

  test('a one-year lease tick moves the estimate by one year of premium', () => {
    const pool = Array.from({ length: 20 }, (_, i) => ({
      slo: 4,
      lease: 50 + 2 * i,
      psf: 300 + 12 * i,
    }));
    const comps = [comp({ lease: 70, psf: 600 })];
    const at = (lease: number) =>
      valuate({ comps, nearby: [], scope: 'lease', pool }, { storey: '', area: 1000, lease })
        .medPsf;
    expect(at(60) - at(59)).toBeCloseTo(6, 6);
  });

  test('caps the storey premium at the floors it was fitted on', () => {
    const pool = Array.from({ length: 12 }, (_, i) => row({ slo: 1 + 3 * i, psf: 600 + 15 * i }));
    const comps = [comp({ slo: 1, psf: 600 })];
    const v = valuate(
      { comps, nearby: pool, scope: 'near', pool: [] },
      { storey: '46 TO 48', area: 1000, lease: 80 },
    );
    expect(v.storeyClampedTo).toBe(34); // highest floor in the pool
    expect(v.medPsf).toBeCloseTo(600 + 5 * 33, 6);
    const inRange = valuate(
      { comps, nearby: pool, scope: 'near', pool: [] },
      { storey: '10 TO 12', area: 1000, lease: 80 },
    );
    expect(inRange.storeyClampedTo).toBeNull();
  });
});

describe('confidence', () => {
  const base = { n: 40, spread: 0.03, scope: 'near' as const, leaseSpan: 10 };
  test('steps down as the adjusted comps spread out', () => {
    expect(confidence(base)).toBe(0);
    expect(confidence({ ...base, spread: 0.06 })).toBe(1);
    expect(confidence({ ...base, spread: 0.1 })).toBe(2);
    expect(confidence({ ...base, spread: 0.2 })).toBe(3);
  });
  test('few comps, a town-wide fallback or mixed leases cap it', () => {
    expect(confidence({ ...base, n: 4 })).toBe(3);
    expect(confidence({ ...base, n: 8 })).toBe(1);
    expect(confidence({ ...base, scope: 'town' })).toBe(2);
    expect(confidence({ ...base, leaseSpan: 25 })).toBe(2);
  });
});
