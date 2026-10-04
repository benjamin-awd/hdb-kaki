import { test, expect, describe } from 'bun:test';
import { moneyShort, ordinal, titleCase } from './format';

describe('ordinal', () => {
  test('st/nd/rd/th, with 11-13 as th', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 42, 83, 100, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '42nd',
      '83rd',
      '100th',
      '101st',
      '111th',
    ]);
    expect(ordinal(0)).toBe('0th');
  });
});

describe('titleCase', () => {
  test('capitalises words and keeps block suffixes upper', () => {
    expect(titleCase('ANG MO KIO')).toBe('Ang Mo Kio');
    expect(titleCase('138A LOR 1A TOA PAYOH')).toBe('138A Lor 1A Toa Payoh');
  });
  test('no capital after an apostrophe', () => {
    expect(titleCase("ST. GEORGE'S LANE")).toBe("St. George's Lane");
    expect(titleCase('ST. GEORGE’S RD')).toBe('St. George’s Rd');
  });
  test('words after punctuation other than an apostrophe still capitalise', () => {
    expect(titleCase('KALLANG/WHAMPOA')).toBe('Kallang/Whampoa');
    expect(titleCase('JLN BT MERAH')).toBe('Jln Bt Merah');
  });
});

describe('moneyShort', () => {
  test('k and m with the sign in front of the $', () => {
    expect(moneyShort(964000)).toBe('$964k');
    expect(moneyShort(1310000)).toBe('$1.31m');
    expect(moneyShort(-481848)).toBe('-$482k');
    expect(moneyShort(500)).toBe('$500');
  });
});
