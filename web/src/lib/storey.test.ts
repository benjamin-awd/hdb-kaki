import { test, expect, describe } from 'bun:test';
import { storeySlope, psfAtStorey } from './storey';

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
