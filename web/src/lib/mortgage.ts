// Affordability & mortgage maths for "My Flat Insights" (section 01.5). Pure and
// DOM-free so it can be unit-tested (mirrors returns.ts / lease.ts). All Singapore
// loan rules that change over time live in LOAN_RULES / MSR / TDSR below, alongside
// RULES_AS_OF, so there is a single place to update them — nothing here is advice.

export type LoanType = 'hdb' | 'bank';

export interface LoanRule {
  /** Short label for the segmented control, e.g. "HDB". */
  label: string;
  /** Illustrative annual interest rate (e.g. 0.026 = 2.6%). */
  rate: number;
  /** Maximum loan-to-value ratio (e.g. 0.75 = up to 75% financed). */
  ltv: number;
  /** Minimum share of the price that must be paid in cash (rest may be CPF OA). */
  minCashPct: number;
  /** Maximum loan tenure in years for this loan type. */
  maxTenureYears: number;
}

// Rules as commonly applied to a resale HDB flat. Illustrative — treat as a guide,
// not a formal assessment. Update these together and bump RULES_AS_OF when they move.
export const LOAN_RULES: Record<LoanType, LoanRule> = {
  hdb: { label: 'HDB', rate: 0.026, ltv: 0.75, minCashPct: 0, maxTenureYears: 25 },
  bank: { label: 'Bank', rate: 0.035, ltv: 0.75, minCashPct: 0.05, maxTenureYears: 30 },
};

/** Mortgage Servicing Ratio cap — monthly instalment ≤ 30% of gross income (HDB flats & ECs). */
export const MSR = 0.3;
/** Total Debt Servicing Ratio cap — all monthly debt ≤ 55% of gross income. */
export const TDSR = 0.55;
/** Human-readable "rules current as of" stamp shown in the UI disclaimer. */
export const RULES_AS_OF = 'July 2026';

/** Tenures and reference rates shown in the sensitivity table. */
export const SENSITIVITY_TENURES = [20, 25, 30] as const;
export const SENSITIVITY_RATES = [0.026, 0.035, 0.04] as const;

/**
 * Standard amortising monthly instalment for a `principal` borrowed at `annualRate`
 * over `years`. Uses M = P·r·(1+r)^n / ((1+r)^n − 1); handles a 0% rate (straight-line)
 * and returns 0 for a non-positive principal or tenure.
 */
export function monthlyInstalment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  const n = years * 12;
  const r = annualRate / 12;
  if (r === 0) return principal / n;
  const f = Math.pow(1 + r, n);
  return (principal * r * f) / (f - 1);
}

/** The longest tenure allowed for `loanType`, further capped so it does not exceed the
 *  flat's remaining lease (and never below 5 years). remainingLease ≤ 0 means "unknown"
 *  and only the loan-type cap applies. */
export function maxTenure(loanType: LoanType, remainingLease: number): number {
  const cap = LOAN_RULES[loanType].maxTenureYears;
  if (remainingLease > 0) return Math.max(5, Math.min(cap, Math.floor(remainingLease)));
  return cap;
}

export interface MortgageInput {
  price: number;
  loanType: LoanType;
  tenureYears: number;
  /** Optional override of the rule rate (e.g. the sensitivity table); defaults to the rule. */
  rate?: number;
}

export interface MortgageResult {
  price: number;
  rate: number;
  ltv: number;
  loan: number; // amount financed
  downpayment: number; // price − loan
  downpaymentPct: number; // downpayment / price
  cash: number; // minimum cash portion of the downpayment
  cpf: number; // CPF OA portion (downpayment − cash)
  cashPct: number; // cash / price
  instalment: number; // monthly repayment
  annualRepayment: number; // instalment × 12
  totalPaid: number; // instalment × months
  totalInterest: number; // totalPaid − loan
  minIncomeMsr: number; // income that puts the instalment at the MSR cap
  minIncomeTdsr: number; // income that puts total debt at the TDSR cap
  minIncome: number; // binding minimum household income (max of the two)
}

/** Full affordability breakdown for one price / loan-type / tenure combination. */
export function computeMortgage({
  price,
  loanType,
  tenureYears,
  rate,
}: MortgageInput): MortgageResult {
  const rule = LOAN_RULES[loanType];
  const usedRate = rate ?? rule.rate;
  const loan = Math.max(0, price * rule.ltv);
  const downpayment = price - loan;
  const cash = price * rule.minCashPct;
  const cpf = Math.max(0, downpayment - cash);

  const instalment = monthlyInstalment(loan, usedRate, tenureYears);
  const months = tenureYears * 12;
  const totalPaid = instalment * months;
  const totalInterest = Math.max(0, totalPaid - loan);

  // MSR binds the instalment alone; TDSR binds all debt (here just the mortgage, so
  // MSR is the tighter of the two whenever there is no other debt). The household needs
  // whichever income clears both caps.
  const minIncomeMsr = MSR > 0 ? instalment / MSR : 0;
  const minIncomeTdsr = TDSR > 0 ? instalment / TDSR : 0;

  return {
    price,
    rate: usedRate,
    ltv: rule.ltv,
    loan,
    downpayment,
    downpaymentPct: price > 0 ? downpayment / price : 0,
    cash,
    cpf,
    cashPct: rule.minCashPct,
    instalment,
    annualRepayment: instalment * 12,
    totalPaid,
    totalInterest,
    minIncomeMsr,
    minIncomeTdsr,
    minIncome: Math.max(minIncomeMsr, minIncomeTdsr),
  };
}

/**
 * Monthly instalment grid for the sensitivity table: one row per tenure, one cell per
 * rate. The loan amount is fixed by the price and the loan type's LTV, so only the rate
 * and tenure vary across the grid.
 */
export function sensitivityTable(
  price: number,
  loanType: LoanType,
  tenures: readonly number[] = SENSITIVITY_TENURES,
  rates: readonly number[] = SENSITIVITY_RATES,
): { tenure: number; instalments: number[] }[] {
  const loan = Math.max(0, price * LOAN_RULES[loanType].ltv);
  return tenures.map((tenure) => ({
    tenure,
    instalments: rates.map((r) => monthlyInstalment(loan, r, tenure)),
  }));
}
