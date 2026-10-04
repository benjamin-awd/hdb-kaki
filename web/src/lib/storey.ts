// Storey and lease adjustments for Flat Insights: how much PSF rises per floor and per year of
// remaining lease, fitted together on recent comparable sales. Fitting both at once matters
// because new blocks are taller, so a storey-only fit would credit floors with the lease
// premium (and a lease-only fit would credit lease with the height).

export interface StoreyPoint {
  slo: number; // storey_lower_bound
  lease: number; // remaining_lease_years
  psf: number;
}

/** Fewest sales the premiums are fitted on; below this there's no adjustment. */
export const STOREY_MIN_N = 10;

/** OLS coefficients of `psf ~ a + storey·slo + lease·lease`, each clamped at 0 (a negative fit
 * is noise: higher floors and longer leases don't sell at a discount). Both 0 when fewer than
 * `minN` usable (all-finite) points or when storey and lease are collinear; a variable with no
 * variation gets 0 and the other is fitted alone. */
export function fitPremiums(
  all: readonly StoreyPoint[],
  minN = STOREY_MIN_N,
): { storey: number; lease: number } {
  const pts = all.filter(
    (p) => Number.isFinite(p.slo) && Number.isFinite(p.lease) && Number.isFinite(p.psf),
  );
  if (pts.length < minN) return { storey: 0, lease: 0 };
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.slo, 0) / n;
  const ml = pts.reduce((s, p) => s + p.lease, 0) / n;
  const my = pts.reduce((s, p) => s + p.psf, 0) / n;
  let sxx = 0,
    sll = 0,
    sxl = 0,
    sxy = 0,
    sly = 0;
  for (const p of pts) {
    const x = p.slo - mx,
      l = p.lease - ml,
      y = p.psf - my;
    sxx += x * x;
    sll += l * l;
    sxl += x * l;
    sxy += x * y;
    sly += l * y;
  }
  const pos = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);
  // One variable constant: a plain simple regression on the other.
  if (!sll) return { storey: sxx ? pos(sxy / sxx) : 0, lease: 0 };
  if (!sxx) return { storey: 0, lease: pos(sly / sll) };
  const det = sxx * sll - sxl * sxl;
  if (Math.abs(det) <= 1e-9 * sxx * sll) return { storey: 0, lease: 0 }; // collinear
  return {
    storey: pos((sxy * sll - sly * sxl) / det),
    lease: pos((sly * sxx - sxy * sxl) / det),
  };
}

/** PSF per floor from `fitPremiums` (0 when it can't be fitted). */
export function storeySlope(pts: readonly StoreyPoint[], minN = STOREY_MIN_N): number {
  return fitPremiums(pts, minN).storey;
}

/** Each comp's PSF shifted to the user's floor along `slope`, sorted ascending. */
export function psfAtStorey(
  comps: readonly StoreyPoint[],
  userLo: number,
  slope: number,
): number[] {
  return comps.map((c) => c.psf + slope * (userLo - c.slo)).sort((a, b) => a - b);
}
