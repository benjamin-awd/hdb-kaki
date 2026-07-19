// Shared number/label formatting for charts and tables.

export const money = (n: number): string =>
  '$' + Math.round(n).toLocaleString('en-SG');

export const moneyShort = (n: number): string => {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'm';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + Math.round(n);
};

export const psf = (n: number): string => '$' + Math.round(n);

export const pct = (n: number): string => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

/**
 * Title-case a SCREAMING town/flat/address label, e.g. "ANG MO KIO" -> "Ang Mo Kio".
 * A letter that directly follows a digit is kept uppercase so HDB block and lane
 * suffixes read correctly, e.g. "138A LOR 1A TOA PAYOH" -> "138A Lor 1A Toa Payoh".
 */
export const titleCase = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\d)([a-z])/g, (_, d, l) => d + l.toUpperCase());
