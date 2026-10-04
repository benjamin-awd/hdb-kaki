// Flat Insights valuation math: comps (from valuationQuery) → estimate, likely range, scale bar
// and confidence. Pure and DOM-free so the page and the backtest (scripts/backtest.ts) run the
// exact same numbers.
import type { CompRow, NearbyRow, CompScope } from './hyparquetCore';
import { storeySlope, psfAtStorey } from './storey';

export const med = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Linear-interpolated quantile of an ascending-sorted array (0 when empty). */
export const quantile = (sorted: number[], p: number) => {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export interface ValuationInput {
  comps: CompRow[];
  nearby: NearbyRow[];
  scope: CompScope;
}
export interface Valuation {
  n: number;
  /** Median PSF of the comps as sold (no adjustment). */
  baseMedPsf: number;
  /** Median PSF after adjusting every comp to this flat. */
  medPsf: number;
  estimate: number;
  low: number;
  high: number;
  /** The "comparable sales" scale under the range, in dollars at this flat's area. */
  barLo: number;
  barHi: number;
  /** Storey premium, $ psf per floor (0 = no adjustment). */
  slope: number;
  useStorey: boolean;
  storeyAdjPct: number;
  confLabel: string;
  confBars: number;
}

/** Value a flat of `area` sqft on storey band `storey` ("10 TO 12") with `lease` years left
 * (0 = unknown) from the query result. */
export function valuate(
  v: ValuationInput,
  { storey, area }: { storey: string; area: number; lease: number },
) {
  const { comps, nearby } = v;
  const baseMedPsf = med(comps.map((c) => c.psf));
  // Storey: shift every comp to the user's floor along the PSF-per-floor slope, fitted on the
  // wider lease-matched pool so a thin comp set still gets a stable, monotonic adjustment.
  const userLo = parseInt(storey, 10) || 0; // "10 TO 12" -> 10
  const slope = storeySlope(nearby.filter((c) => c.match));
  const useStorey = slope > 0 && userLo > 0;
  const psfs = useStorey
    ? psfAtStorey(comps, userLo, slope)
    : comps.map((c) => c.psf).sort((a, b) => a - b);
  const medPsf = med(psfs);
  const n = comps.length;
  const [confLabel, confBars] =
    n >= 30 ? ['High', 4] : n >= 15 ? ['Medium-High', 3] : n >= 5 ? ['Medium', 2] : ['Low', 1];
  // The bar is what the comps actually sold for (10th–90th pct, unadjusted, at this area).
  const rawPsfs = comps.map((c) => c.psf).sort((a, b) => a - b);
  return {
    n,
    baseMedPsf,
    medPsf,
    estimate: medPsf * area,
    low: quantile(psfs, 0.25) * area,
    high: quantile(psfs, 0.75) * area,
    barLo: quantile(rawPsfs, 0.1) * area,
    barHi: quantile(rawPsfs, 0.9) * area,
    slope,
    useStorey,
    storeyAdjPct: baseMedPsf ? (medPsf / baseMedPsf - 1) * 100 : 0,
    confLabel: confLabel as string,
    confBars: confBars as number,
  } satisfies Valuation;
}
