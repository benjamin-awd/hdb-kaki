import { test, expect, describe } from 'bun:test';
import { toCsv } from './csv';

describe('toCsv', () => {
  test('emits a header row then the data rows, CRLF-separated', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', '2'],
          ['3', '4'],
        ],
      ),
    ).toBe('a,b\r\n1,2\r\n3,4');
  });

  test('stringifies numbers and empty-renders null/undefined', () => {
    expect(
      toCsv(
        ['n', 'x'],
        [
          [42, null],
          [0, undefined],
        ],
      ),
    ).toBe('n,x\r\n42,\r\n0,');
  });

  test('quotes fields containing a comma', () => {
    expect(toCsv(['addr'], [['BLK 1, ANG MO KIO']])).toBe('addr\r\n"BLK 1, ANG MO KIO"');
  });

  test('quotes and doubles embedded quotes', () => {
    expect(toCsv(['q'], [['say "hi"']])).toBe('q\r\n"say ""hi"""');
  });

  test('quotes fields containing newlines', () => {
    expect(toCsv(['multi'], [['line1\nline2']])).toBe('multi\r\n"line1\nline2"');
  });

  test('leaves plain fields unquoted', () => {
    expect(toCsv(['s'], [['BISHAN ST 12']])).toBe('s\r\nBISHAN ST 12');
  });
});
