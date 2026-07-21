import { test, expect, describe } from 'bun:test';
import {
  LOAN_RULES,
  MSR,
  TDSR,
  monthlyInstalment,
  maxTenure,
  computeMortgage,
  sensitivityTable,
} from './mortgage';

describe('monthlyInstalment', () => {
  test('matches the closed-form amortisation formula', () => {
    const P = 487500,
      annual = 0.026,
      years = 25;
    const r = annual / 12,
      n = years * 12,
      f = Math.pow(1 + r, n);
    expect(monthlyInstalment(P, annual, years)).toBeCloseTo((P * r * f) / (f - 1), 6);
  });
  test('a 0% rate is straight-line principal / months', () => {
    expect(monthlyInstalment(120000, 0, 10)).toBeCloseTo(1000, 6); // 120k / 120mo
  });
  test('a higher rate or shorter tenure raises the instalment', () => {
    const base = monthlyInstalment(487500, 0.026, 25);
    expect(monthlyInstalment(487500, 0.035, 25)).toBeGreaterThan(base); // higher rate
    expect(monthlyInstalment(487500, 0.026, 20)).toBeGreaterThan(base); // shorter tenure
  });
  test('non-positive principal or tenure -> 0', () => {
    expect(monthlyInstalment(0, 0.026, 25)).toBe(0);
    expect(monthlyInstalment(-1, 0.026, 25)).toBe(0);
    expect(monthlyInstalment(487500, 0.026, 0)).toBe(0);
  });
});

describe('maxTenure', () => {
  test('clamps to the flat’s remaining lease when it is the tighter limit', () => {
    expect(maxTenure('hdb', 18)).toBe(18); // below the 25y HDB cap
    expect(maxTenure('bank', 22)).toBe(22); // below the 30y bank cap
  });
  test('uses the loan-type cap when the lease is longer', () => {
    expect(maxTenure('hdb', 78)).toBe(25);
    expect(maxTenure('bank', 78)).toBe(30);
  });
  test('never returns below the 5-year floor', () => {
    expect(maxTenure('hdb', 2)).toBe(5);
  });
  test('unknown lease (<= 0) falls back to the loan-type cap', () => {
    expect(maxTenure('hdb', 0)).toBe(25);
    expect(maxTenure('bank', -1)).toBe(30);
  });
});

describe('computeMortgage', () => {
  test('splits a $650k HDB purchase into loan and downpayment by LTV', () => {
    const m = computeMortgage({ price: 650000, loanType: 'hdb', tenureYears: 25 });
    expect(m.loan).toBe(487500); // 75% LTV
    expect(m.downpayment).toBe(162500); // 25%
    expect(m.downpaymentPct).toBeCloseTo(0.25, 10);
    expect(m.rate).toBe(LOAN_RULES.hdb.rate);
  });

  test('HDB downpayment can be fully CPF (0 minimum cash)', () => {
    const m = computeMortgage({ price: 650000, loanType: 'hdb', tenureYears: 25 });
    expect(m.cash).toBe(0);
    expect(m.cpf).toBe(162500);
  });

  test('bank loan carries a 5% minimum cash floor, rest CPF', () => {
    const m = computeMortgage({ price: 650000, loanType: 'bank', tenureYears: 25 });
    expect(m.cash).toBe(32500); // 5% of price
    expect(m.cpf).toBe(130000); // remaining 20%
    expect(m.cash + m.cpf).toBeCloseTo(m.downpayment, 6);
  });

  test('total interest is total repayments minus the loan, and is positive', () => {
    const m = computeMortgage({ price: 650000, loanType: 'hdb', tenureYears: 25 });
    expect(m.totalPaid).toBeCloseTo(m.instalment * 300, 6);
    expect(m.totalInterest).toBeCloseTo(m.totalPaid - m.loan, 6);
    expect(m.totalInterest).toBeGreaterThan(0);
  });

  test('minimum income is MSR-bound (instalment / 30%) when there is no other debt', () => {
    const m = computeMortgage({ price: 650000, loanType: 'hdb', tenureYears: 25 });
    expect(m.minIncomeMsr).toBeCloseTo(m.instalment / MSR, 6);
    expect(m.minIncomeTdsr).toBeCloseTo(m.instalment / TDSR, 6);
    // MSR (30%) is tighter than TDSR (55%) -> it binds.
    expect(m.minIncome).toBeCloseTo(m.minIncomeMsr, 6);
    expect(m.minIncomeMsr).toBeGreaterThan(m.minIncomeTdsr);
  });

  test('an explicit rate override is used in place of the rule rate', () => {
    const m = computeMortgage({ price: 650000, loanType: 'hdb', tenureYears: 25, rate: 0.04 });
    expect(m.rate).toBe(0.04);
    expect(m.instalment).toBeCloseTo(monthlyInstalment(m.loan, 0.04, 25), 6);
  });
});

describe('sensitivityTable', () => {
  test('is a tenure × rate grid off a single LTV-derived loan amount', () => {
    const rows = sensitivityTable(650000, 'hdb');
    expect(rows.map((r) => r.tenure)).toEqual([20, 25, 30]);
    const loan = 650000 * LOAN_RULES.hdb.ltv;
    expect(rows[1].instalments[0]).toBeCloseTo(monthlyInstalment(loan, 0.026, 25), 6);
  });
  test('instalment falls as tenure lengthens within a rate column', () => {
    const rows = sensitivityTable(650000, 'hdb');
    expect(rows[0].instalments[0]).toBeGreaterThan(rows[1].instalments[0]); // 20y > 25y
    expect(rows[1].instalments[0]).toBeGreaterThan(rows[2].instalments[0]); // 25y > 30y
  });
});
