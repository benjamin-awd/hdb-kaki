import { test, expect, describe } from 'bun:test';
import { encodeParams, decodeParams, deviatesFromDefaults } from './urlState';

// The DOM-binding layer (bindings + createUrlState) touches document/history/location and
// is covered by the Playwright e2e specs; these unit tests pin the pure codec, which is
// where the shareable-link contract actually lives.

const defaults = { town: 'ANG MO KIO', flat: '4 ROOM', street: '__all', thr: '0.1' };
const order = ['town', 'flat', 'street', 'thr'];

describe('encodeParams', () => {
  test('omits values equal to their default', () => {
    expect(encodeParams({ ...defaults }, defaults, order)).toBe('');
  });

  test('omits empty / missing values', () => {
    expect(encodeParams({ town: '', flat: '4 ROOM' }, defaults, order)).toBe('');
  });

  test('emits only the deviating keys, in the given order', () => {
    const qs = encodeParams(
      { town: 'BISHAN', flat: '5 ROOM', street: '__all', thr: '0.15' },
      defaults,
      order,
    );
    expect(qs).toBe('?town=BISHAN&flat=5+ROOM&thr=0.15');
  });

  test('escapes a space in a value as +', () => {
    expect(encodeParams({ flat: '5 ROOM' }, defaults, order)).toBe('?flat=5+ROOM');
  });

  test('key order follows `order`, not the values object', () => {
    const qs = encodeParams({ thr: '0.15', town: 'BEDOK' }, defaults, order);
    expect(qs).toBe('?town=BEDOK&thr=0.15');
  });
});

describe('decodeParams', () => {
  test('keeps known keys and merges over the defaults', () => {
    expect(decodeParams('?town=BEDOK&flat=5+ROOM', defaults)).toEqual({
      town: 'BEDOK',
      flat: '5 ROOM',
      street: '__all',
      thr: '0.1',
    });
  });

  test('drops unknown/garbage keys', () => {
    expect(decodeParams('?town=BEDOK&evil=1&=x', defaults)).toEqual({
      ...defaults,
      town: 'BEDOK',
    });
  });

  test('treats an empty value as absent (keeps default)', () => {
    expect(decodeParams('?town=&flat=5+ROOM', defaults)).toEqual({
      ...defaults,
      flat: '5 ROOM',
    });
  });

  test('round-trips through encodeParams', () => {
    const values = { town: 'CLEMENTI', flat: '3 ROOM', street: 'CLEMENTI AVE 4', thr: '0.05' };
    expect(decodeParams(encodeParams(values, defaults, order), defaults)).toEqual(values);
  });
});

describe('deviatesFromDefaults', () => {
  test('false for an empty search', () => {
    expect(deviatesFromDefaults('', defaults)).toBe(false);
  });

  test('false when every known key equals its default', () => {
    expect(deviatesFromDefaults('?town=ANG+MO+KIO&flat=4+ROOM&thr=0.1', defaults)).toBe(false);
  });

  test('false when only unknown keys are present', () => {
    expect(deviatesFromDefaults('?evil=1&other=2', defaults)).toBe(false);
  });

  test('true when any known key deviates', () => {
    expect(deviatesFromDefaults('?town=BEDOK', defaults)).toBe(true);
    expect(deviatesFromDefaults('?thr=0.15', defaults)).toBe(true);
  });

  test('an empty value does not count as a deviation', () => {
    expect(deviatesFromDefaults('?town=', defaults)).toBe(false);
  });
});
