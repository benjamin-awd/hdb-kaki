import { test, expect, describe } from 'bun:test';
import { valuate, med, quantile } from './valuation';
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
      { comps, nearby: comps.map((c) => ({ ...c, dist: 0, match: true })), scope: 'near' },
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
      { comps, nearby: pool, scope: 'near' },
      { storey: '10 TO 12', area: 1000, lease: 80 },
    );
    expect(v.slope).toBeCloseTo(5, 6);
    expect(v.useStorey).toBe(true);
    expect(v.medPsf).toBeCloseTo(645, 6);
  });
});
