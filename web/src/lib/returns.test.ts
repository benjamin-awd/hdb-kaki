import { test, expect, describe } from 'bun:test';
import {
  formatThousands, parsePrice, reformatWithCaret, nearestYear, computeReturns,
} from './returns';

describe('formatThousands', () => {
  test('inserts separators', () => {
    expect(formatThousands('380000')).toBe('380,000');
    expect(formatThousands('1000000')).toBe('1,000,000');
    expect(formatThousands('999')).toBe('999');
  });
  test('strips non-digits (typed or pasted junk)', () => {
    expect(formatThousands('$380,000')).toBe('380,000');
    expect(formatThousands('380000abc')).toBe('380,000');
    expect(formatThousands('3.8e5')).toBe('385'); // only digits survive
  });
  test('empty / no digits -> empty string', () => {
    expect(formatThousands('')).toBe('');
    expect(formatThousands('abc')).toBe('');
    expect(formatThousands('$,')).toBe('');
  });
});

describe('parsePrice', () => {
  test('round-trips a formatted value', () => {
    expect(parsePrice('380,000')).toBe(380000);
    expect(parsePrice(formatThousands('1250000'))).toBe(1250000);
  });
  test('invalid -> 0', () => {
    expect(parsePrice('')).toBe(0);
    expect(parsePrice('abc')).toBe(0);
  });
});

describe('reformatWithCaret', () => {
  test('keeps the caret after the same digit when a separator shifts in', () => {
    // typing the 4th digit of "3800" -> "3,800"; caret was after 4 digits.
    const r = reformatWithCaret('3800', 4);
    expect(r.value).toBe('3,800');
    expect(r.caret).toBe(5); // still after all 4 digits (past the comma)
  });
  test('caret in the middle stays anchored to its digit', () => {
    // caret after 1 digit of "1234" -> "1,234", still after the "1".
    const r = reformatWithCaret('1234', 1);
    expect(r.value).toBe('1,234');
    expect(r.caret).toBe(1);
  });
  test('empty stays empty with caret at 0', () => {
    expect(reformatWithCaret('', 0)).toEqual({ value: '', caret: 0 });
  });
});

describe('nearestYear', () => {
  const series = { '2012': 1, '2015': 1, '2020': 1, '2024': 1 };
  test('returns an exact year unchanged', () => {
    expect(nearestYear(series, 2015)).toBe('2015');
  });
  test('snaps a gap year to the closest present year', () => {
    expect(nearestYear(series, 2013)).toBe('2012'); // 1 away vs 2 to 2015
    expect(nearestYear(series, 2014)).toBe('2015');
    expect(nearestYear(series, 2022)).toBe('2020'); // ties broken toward earlier
  });
  test('clamps outside the range', () => {
    expect(nearestYear(series, 1990)).toBe('2012');
    expect(nearestYear(series, 2030)).toBe('2024');
  });
  test('empty series -> empty string', () => {
    expect(nearestYear({}, 2015)).toBe('');
  });
});

describe('computeReturns', () => {
  const town = { '2012': 400000, '2015': 480000, '2020': 600000, '2024': 700000 };
  const NOW = 2026;

  test('basic gain and total return use the real buy->now window', () => {
    const r = computeReturns(480000, 2015, 720000, NOW, town, '2024');
    expect(r.gain).toBe(240000);
    expect(r.totRet).toBeCloseTo(50, 5);
    expect(r.hold).toBe(11);
  });

  test('user CAGR and town CAGR share the same span; beat is their exact difference', () => {
    const r = computeReturns(480000, 2015, 720000, NOW, town, '2024');
    // span = 2024 - 2015 = 9 for both
    expect(r.haveTown).toBe(true);
    expect(r.cagr).toBeCloseTo((Math.pow(720000 / 480000, 1 / 9) - 1) * 100, 6);
    expect(r.townCagr).toBeCloseTo((Math.pow(700000 / 480000, 1 / 9) - 1) * 100, 6);
    expect(r.beat).toBeCloseTo(r.cagr - r.townCagr, 10); // subtractable in the UI
  });

  test('buy year in a gap snaps to the nearest town year for the benchmark', () => {
    const r = computeReturns(400000, 2013, 800000, NOW, town, '2024');
    // snaps to 2012 -> span 12, town still defined (was the silent-drop bug)
    expect(r.haveTown).toBe(true);
    expect(r.townCagr).toBeCloseTo((Math.pow(700000 / 400000, 1 / 12) - 1) * 100, 6);
  });

  test('no town data -> falls back to the actual holding period, no benchmark', () => {
    const r = computeReturns(480000, 2015, 720000, NOW, {}, '');
    expect(r.haveTown).toBe(false);
    expect(Number.isNaN(r.townCagr)).toBe(true);
    expect(Number.isNaN(r.beat)).toBe(true);
    expect(r.cagr).toBeCloseTo((Math.pow(720000 / 480000, 1 / r.hold) - 1) * 100, 6);
  });

  test('single-year town span (bYear == latestYear) avoids divide-by-zero', () => {
    const r = computeReturns(690000, 2023, 700000, NOW, { '2024': 700000 }, '2024');
    expect(r.haveTown).toBe(false); // span 0, benchmark dropped
    expect(Number.isFinite(r.cagr)).toBe(true); // used hold, not 1/0
  });

  test('a loss produces a negative gain and return', () => {
    const r = computeReturns(600000, 2020, 540000, NOW, town, '2024');
    expect(r.gain).toBe(-60000);
    expect(r.totRet).toBeLessThan(0);
    expect(r.cagr).toBeLessThan(0);
  });
});
