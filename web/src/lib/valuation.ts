// Flat Insights valuation math: comps (from valuationQuery) → estimate, likely range, scale bar
// and confidence. Pure and DOM-free so the page and the backtest (scripts/backtest.ts) run the
// exact same numbers.
import type { CompRow, NearbyRow, CompScope } from './hyparquetCore';
import { fitPremiums, type StoreyPoint } from './storey';

/** Comps match this flat's remaining lease within ± this many years (valuationQuery). */
export const COMP_LEASE_BAND = 15;
/** Similar-lease sales are drawn from the tightest of these rings (metres) holding at least
 * COMP_NEAR_MIN of them, before falling back to the whole town. */
export const COMP_RADII = [300, 500, 1000] as const;
export const COMP_NEAR_MIN = 10;

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
  pool: StoreyPoint[];
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
  /** How tightly the adjusted comps agree: their interquartile range over the median. */
  spread: number;
  /** Storey premium, $ psf per floor (0 = no adjustment). */
  slope: number;
  useStorey: boolean;
  /** The floor the storey premium was capped at, when the chosen storey lies outside the
   * floors the premium was fitted on; null when it wasn't capped. */
  storeyClampedTo: number | null;
  /** Median shift from moving the comps to this flat's storey, %. */
  storeyAdjPct: number;
  /** Lease premium, $ psf per year of remaining lease (0 = no adjustment). */
  leaseCoef: number;
  /** Further median shift from moving the comps to this flat's remaining lease, %. */
  leaseAdjPct: number;
  confLabel: string;
  confBars: number;
}

const CONF_LABELS = ['High', 'Medium-High', 'Medium', 'Low'];
/** Spread (IQR / median of the adjusted comps) at which confidence drops a level. Calibrated
 * on the backtest: median error ran 2.7% / 3.7% / 4.8% / 8.5% across the four levels, while
 * the number of comps barely predicted error at all. */
export const CONF_SPREAD = [0.05, 0.08, 0.14] as const;

/** Confidence level, 0 = High … 3 = Low, from how tightly the adjusted comps agree, capped
 * when there are few of them or they are a poor match for the flat (a town-wide fallback, or
 * leases more than 20 years apart). */
export function confidence({
  n,
  spread,
  scope,
  leaseSpan,
}: {
  n: number;
  spread: number;
  scope: CompScope;
  leaseSpan: number;
}): 0 | 1 | 2 | 3 {
  if (n < 5) return 3;
  let level = CONF_SPREAD.findIndex((t) => spread < t);
  if (level < 0) level = 3;
  if (n < 10) level = Math.max(level, 1);
  if (scope === 'town' || leaseSpan > 20) level = Math.max(level, 2);
  return level as 0 | 1 | 2 | 3;
}

/** Value a flat of `area` sqft on storey band `storey` ("10 TO 12") with `lease` years left
 * (0 = unknown) from the query result. */
export function valuate(
  v: ValuationInput,
  { storey, area, lease }: { storey: string; area: number; lease: number },
) {
  const { comps, nearby } = v;
  const baseMedPsf = med(comps.map((c) => c.psf));
  // Shift every comp to this flat's floor and remaining lease. Adjusting for lease (not just
  // matching on it) keeps the estimate smooth as sales enter or leave the lease band, e.g. when
  // every lease ticks down on 1 January.
  // - Per-floor premium: fitted on the lease-matched sales (the local market). A town-wide
  //   fallback has too few of those, so it fits on its own comps.
  // - Per-year lease premium: fitted on every town sale of the type. A pool that doesn't move
  //   with this flat's lease keeps the coefficient stable year to year (fitting it on the
  //   lease band swung it several-fold as sales crossed the band edge).
  const matched = nearby.filter((c) => c.match);
  const storeyPool = matched.length >= 10 ? matched : comps;
  const slope = fitPremiums(storeyPool).storey;
  // Don't extrapolate the per-floor premium past the floors it was fitted on: a flat above
  // every sale is valued as the highest floor sold (likewise below the lowest).
  const askedLo = parseInt(storey, 10) || 0; // "10 TO 12" -> 10
  const floors = storeyPool.map((c) => c.slo);
  const userLo =
    askedLo && floors.length
      ? Math.min(Math.max(askedLo, Math.min(...floors)), Math.max(...floors))
      : askedLo;
  const leaseCoef = lease > 0 ? fitPremiums(v.pool).lease : 0;
  const useStorey = slope > 0 && userLo > 0;
  const atStorey = (c: CompRow) => c.psf + (useStorey ? slope * (userLo - c.slo) : 0);
  const storeyPsfs = comps.map(atStorey);
  const psfs = comps
    .map((c, i) => storeyPsfs[i] + leaseCoef * (lease - c.lease))
    .sort((a, b) => a - b);
  const medPsf = med(psfs);
  const storeyMedPsf = med(storeyPsfs);
  const n = comps.length;
  const spread = medPsf ? (quantile(psfs, 0.75) - quantile(psfs, 0.25)) / medPsf : 0;
  const leases = comps.map((c) => c.lease);
  const leaseSpan = n ? Math.max(...leases) - Math.min(...leases) : 0;
  const conf = confidence({ n, spread, scope: v.scope, leaseSpan });
  // Likely range: the middle 80% of the adjusted comps (q25–q75 held only ~47% of actual
  // prices in the backtest; q10–q90 holds ~75%).
  const low = quantile(psfs, 0.1) * area,
    high = quantile(psfs, 0.9) * area;
  // The bar is what the comps actually sold for (5th–95th pct, unadjusted, at this area),
  // stretched to take in the likely range so the estimate and its range always sit on it.
  const rawPsfs = comps.map((c) => c.psf).sort((a, b) => a - b);
  return {
    n,
    baseMedPsf,
    medPsf,
    estimate: medPsf * area,
    low,
    high,
    barLo: Math.min(quantile(rawPsfs, 0.05) * area, low),
    barHi: Math.max(quantile(rawPsfs, 0.95) * area, high),
    spread,
    slope,
    useStorey,
    storeyClampedTo: useStorey && userLo !== askedLo ? userLo : null,
    storeyAdjPct: baseMedPsf ? (storeyMedPsf / baseMedPsf - 1) * 100 : 0,
    leaseCoef,
    leaseAdjPct: storeyMedPsf ? (medPsf / storeyMedPsf - 1) * 100 : 0,
    confLabel: CONF_LABELS[conf],
    confBars: 4 - conf,
  } satisfies Valuation;
}
