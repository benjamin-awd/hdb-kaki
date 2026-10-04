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

describe('storeySlope degenerate input', () => {
  test('empty or below minN gives 0; a custom minN is honoured', () => {
    expect(storeySlope([])).toBe(0);
    const pts = Array.from({ length: 5 }, (_, i) => ({ slo: i, lease: 80, psf: 900 + 3 * i }));
    expect(storeySlope(pts)).toBe(0);
    expect(storeySlope(pts, 5)).toBeCloseTo(3, 9);
  });

  test('every sale on one storey gives 0, whether or not leases vary', () => {
    const flat = Array.from({ length: 12 }, () => ({ slo: 4, lease: 80, psf: 900 }));
    expect(storeySlope(flat)).toBe(0);
    const leases = Array.from({ length: 12 }, (_, i) => ({
      slo: 4,
      lease: 60 + i,
      psf: 600 + 10 * i,
    }));
    expect(storeySlope(leases)).toBe(0); // was NaN: det 0 slipped past a strict `<`
  });

  test('storey exactly collinear with lease gives 0', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({
      slo: i,
      lease: 50 + 2 * i,
      psf: 500 + 7 * i,
    }));
    expect(storeySlope(pts)).toBe(0);
  });

  test('a negative fit with lease varying is clamped to 0', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({
      slo: i,
      lease: 60 + (i % 3) * 10,
      psf: 1000 - 4 * i + 5 * (i % 3) * 10,
    }));
    expect(storeySlope(pts)).toBe(0);
  });

  test('non-finite points are skipped, and count against minN', () => {
    const good = Array.from({ length: 12 }, (_, i) => ({
      slo: i * 3 + 1,
      lease: 85,
      psf: 900 + 6 * (i * 3 + 1),
    }));
    const bad = [
      { slo: 5, lease: NaN, psf: 950 },
      { slo: 5, lease: 85, psf: NaN },
    ];
    expect(storeySlope([...good, ...bad])).toBeCloseTo(6, 6);
    expect(storeySlope([...good.slice(0, 9), ...bad])).toBe(0);
  });
});

describe('psfAtStorey', () => {
  test('shifts every comp to the user floor', () => {
    const comps = [
      { slo: 1, lease: 85, psf: 900 },
      { slo: 28, lease: 85, psf: 1100 },
    ];
    expect(psfAtStorey(comps, 16, 6)).toEqual([990, 1028]);
  });

  test('slope 0 just sorts; a lower user floor shifts down; empty stays empty', () => {
    const two = [
      { slo: 1, lease: 0, psf: 900 },
      { slo: 9, lease: 0, psf: 800 },
    ];
    expect(psfAtStorey(two, 5, 0)).toEqual([800, 900]);
    expect(psfAtStorey([{ slo: 10, lease: 0, psf: 1000 }], 1, 5)).toEqual([955]);
    expect(psfAtStorey([], 10, 5)).toEqual([]);
  });

  test('does not reorder its input', () => {
    const c = [
      { slo: 1, lease: 0, psf: 900 },
      { slo: 1, lease: 0, psf: 100 },
    ];
    psfAtStorey(c, 1, 1);
    expect(c[0].psf).toBe(900);
  });
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
