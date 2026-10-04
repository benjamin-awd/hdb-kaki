import { test, expect, describe } from 'bun:test';
import { storeySlope, psfAtStorey, fitPremiums } from './storey';

describe('storeySlope', () => {
  test('recovers the per-floor premium', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({
      slo: i * 3 + 1,
      lease: 85,
      psf: 900 + 6 * (i * 3 + 1),
    }));
    expect(storeySlope(pts)).toBeCloseTo(6, 6);
  });

  test('separates the storey premium from the lease premium', () => {
    // Old blocks are low-rise and cheap, new blocks tall and dear: storey alone would look steep.
    const pts = [
      ...Array.from({ length: 8 }, (_, i) => ({ slo: 1 + i, lease: 45, psf: 500 + 2 * (1 + i) })),
      ...Array.from({ length: 8 }, (_, i) => ({
        slo: 20 + i,
        lease: 90,
        psf: 1100 + 2 * (20 + i),
      })),
      ...Array.from({ length: 4 }, (_, i) => ({ slo: 4 + i, lease: 90, psf: 1100 + 2 * (4 + i) })),
    ];
    expect(storeySlope(pts)).toBeCloseTo(2, 6);
  });

  test('clamps a negative fit to 0 and needs enough points', () => {
    const down = Array.from({ length: 12 }, (_, i) => ({ slo: i, lease: 80, psf: 1000 - 5 * i }));
    expect(storeySlope(down)).toBe(0);
    expect(storeySlope(down.slice(0, 5))).toBe(0);
  });
});

test('psfAtStorey shifts every comp to the user floor', () => {
  const comps = [
    { slo: 1, lease: 85, psf: 900 },
    { slo: 28, lease: 85, psf: 1100 },
  ];
  expect(psfAtStorey(comps, 16, 6)).toEqual([990, 1028]);
});

describe('fitPremiums', () => {
  test('fits storey and lease premiums together', () => {
    const pts = Array.from({ length: 30 }, (_, i) => {
      const slo = 1 + (i % 10) * 3,
        lease = 50 + ((i * 7) % 40);
      return { slo, lease, psf: 200 + 4 * slo + 6 * lease };
    });
    const f = fitPremiums(pts);
    expect(f.storey).toBeCloseTo(4, 6);
    expect(f.lease).toBeCloseTo(6, 6);
  });

  test('fits lease alone when every sale is on one storey (no NaN)', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({
      slo: 4,
      lease: 60 + i,
      psf: 600 + 10 * i,
    }));
    expect(fitPremiums(pts)).toEqual({ storey: 0, lease: 10 });
    expect(storeySlope(pts)).toBe(0);
  });

  test('clamps a negative lease premium to 0', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({
      slo: 1 + i,
      lease: 60 + ((i * 5) % 12),
      psf: 900 - 3 * (60 + ((i * 5) % 12)),
    }));
    expect(fitPremiums(pts).lease).toBe(0);
  });
});
