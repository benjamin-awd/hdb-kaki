// Storey adjustment for Flat Insights: how much PSF rises per floor, fitted on recent
// comparable sales. Lease is a covariate because new blocks are taller, so a storey-only fit
// would credit floors with the lease premium.

export interface StoreyPoint {
  slo: number; // storey_lower_bound
  lease: number; // remaining_lease_years
  psf: number;
}

/** OLS slope of PSF per floor from `psf ~ a + b·storey + c·lease`, clamped at 0 (a negative
 * fit is noise: HDB floors don't sell at a discount to the ones below). 0 when fewer than
 * `minN` points or the fit is degenerate. */
export function storeySlope(pts: readonly StoreyPoint[], minN = 10): number {
  if (pts.length < minN) return 0;
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
  // No lease variation: plain simple regression on storey.
  if (sll === 0) return sxx ? Math.max(0, sxy / sxx) : 0;
  const det = sxx * sll - sxl * sxl;
  if (Math.abs(det) < 1e-9 * sxx * sll) return 0; // storey and lease collinear
  return Math.max(0, (sxy * sll - sly * sxl) / det);
}

/** Each comp's PSF shifted to the user's floor along `slope`, sorted ascending. */
export function psfAtStorey(
  comps: readonly StoreyPoint[],
  userLo: number,
  slope: number,
): number[] {
  return comps.map((c) => c.psf + slope * (userLo - c.slo)).sort((a, b) => a - b);
}
