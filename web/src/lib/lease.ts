// SLA Leasehold Relativity Table — leasehold value as a percentage of freehold
// by remaining lease term (Source: Singapore Land Authority). Used to normalise
// comparable sales to a flat's own remaining lease so a longer/shorter lease
// moves the valuation. Index = whole years remaining (0..99).
// prettier-ignore
export const SLA_LEASEHOLD = [
  0, 3.8, 7.5, 10.9, 14.1, 17.1, 19.9, 22.7, 25.2, 27.7, 30.0,
  32.2, 34.3, 36.3, 38.2, 40.0, 41.8, 43.4, 45.0, 46.6, 48.0,
  49.5, 50.8, 52.1, 53.4, 54.6, 55.8, 56.9, 58.0, 59.0, 60.0,
  61.0, 61.9, 62.8, 63.7, 64.6, 65.4, 66.2, 67.0, 67.7, 68.5,
  69.2, 69.8, 70.5, 71.2, 71.8, 72.4, 73.0, 73.6, 74.1, 74.7,
  75.2, 75.7, 76.2, 76.7, 77.3, 77.9, 78.5, 79.0, 79.5, 80.0,
  80.6, 81.2, 81.8, 82.4, 83.0, 83.6, 84.2, 84.5, 85.4, 86.0,
  86.5, 87.0, 87.5, 88.0, 88.5, 89.0, 89.5, 90.0, 90.5, 91.0,
  91.4, 91.8, 92.2, 92.6, 92.9, 93.3, 93.6, 94.0, 94.3, 94.6,
  94.8, 95.0, 95.2, 95.4, 95.6, 95.7, 95.8, 95.9, 96.0,
];

/**
 * Leasehold value as a percentage of freehold for a given remaining lease,
 * read off the SLA table. Years are clamped to [0, 99] and interpolated
 * linearly for fractional inputs (a median comp lease need not be a whole year).
 */
export function leaseFactor(years: number): number {
  const y = Math.max(0, Math.min(99, years));
  const lo = Math.floor(y),
    hi = Math.ceil(y);
  return SLA_LEASEHOLD[lo] + (SLA_LEASEHOLD[hi] - SLA_LEASEHOLD[lo]) * (y - lo);
}

export interface LeaseAdjustment {
  /** Multiplicative factor to apply to comp PSF; 1 when not computable. */
  factor: number;
  /** The factor as a percentage delta, e.g. -16.3. */
  pct: number;
  /** False when either lease is missing/non-positive, so the UI shows n/a. */
  known: boolean;
}

/**
 * How much a flat's own remaining lease shifts its value versus the comps it is
 * priced against. Returns the SLA-table ratio leaseFactor(rem)/leaseFactor(comp):
 * a longer lease than the comps lifts the estimate, a shorter one discounts it.
 * Falls back to a no-op factor of 1 when either lease is unknown.
 */
export function leaseAdjustment(remYears: number, compLease: number): LeaseAdjustment {
  const known = remYears > 0 && compLease > 0;
  const factor = known ? leaseFactor(remYears) / leaseFactor(compLease) : 1;
  return { factor, pct: (factor - 1) * 100, known };
}
