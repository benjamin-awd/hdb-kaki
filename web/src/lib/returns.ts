// "Your return so far" (my-flat-insights) — purchase-price formatting and the
// annualised-return maths, kept pure and DOM-free so they can be unit-tested.

/** Format a raw string as a thousands-separated integer, dropping any non-digits.
 *  "$380,00a" -> "380,000"; "" -> "". */
export const formatThousands = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('en-SG') : '';
};

/** Parse a possibly comma-formatted price back to a number; invalid -> 0. */
export const parsePrice = (v: string): number => Number(v.replace(/,/g, '')) || 0;

/** Reformat `raw` with thousands separators and return the caret position that
 *  keeps the same number of digits to its left — the pure core of the live input
 *  formatter (the DOM read/write stays in the page). */
export function reformatWithCaret(raw: string, caret: number): { value: string; caret: number } {
  const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
  const value = formatThousands(raw);
  let pos = 0, seen = 0;
  while (pos < value.length && seen < digitsBefore) { if (/\d/.test(value[pos])) seen++; pos++; }
  return { value, caret: pos };
}

/** Year present in the town series that is closest to `y` (handles gaps in the
 *  series); '' when the series is empty. */
export const nearestYear = (townYearPrice: Record<string, number>, y: number): string => {
  const ys = Object.keys(townYearPrice).map(Number).sort((a, b) => a - b);
  if (!ys.length) return '';
  return String(ys.reduce((best, yr) => (Math.abs(yr - y) < Math.abs(best - y) ? yr : best), ys[0]));
};

export interface ReturnStats {
  hold: number;      // years held (buy year -> now)
  gain: number;      // dollar gain (estimate - paid)
  totRet: number;    // total return %, buy -> now
  cagr: number;      // user's annualised return %
  townCagr: number;  // town's annualised return % (NaN when no town data)
  beat: number;      // cagr - townCagr (NaN when no town data)
  haveTown: boolean; // whether a town benchmark was available
}

/** Compute the "Your return so far" figures. When town data exists, the user's
 *  CAGR is annualised over the SAME span as the town (bYear -> latestYear) so the
 *  two are like-for-like; otherwise it falls back to the actual holding period. */
export function computeReturns(
  paid: number,
  buyYear: number,
  estimate: number,
  nowYear: number,
  townYearPrice: Record<string, number>,
  latestYear: string,
): ReturnStats {
  const hold = nowYear - buyYear;
  const gain = estimate - paid;
  const totRet = (estimate / paid - 1) * 100;
  const bYear = nearestYear(townYearPrice, buyYear);
  const py = townYearPrice[bYear], cy = townYearPrice[latestYear];
  const span = Number(latestYear) - Number(bYear);
  const haveTown = !!py && !!cy && span > 0;
  const period = haveTown ? span : hold;
  const cagr = (Math.pow(estimate / paid, 1 / period) - 1) * 100;
  const townCagr = haveTown ? (Math.pow(cy / py, 1 / span) - 1) * 100 : NaN;
  const beat = cagr - townCagr;
  return { hold, gain, totRet, cagr, townCagr, beat, haveTown };
}
