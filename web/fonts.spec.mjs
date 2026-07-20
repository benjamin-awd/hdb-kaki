// Single source of truth for the site's fonts.
//
// Both astro.config.mjs (which builds the `local` font provider) and
// scripts/vendor-fonts.mjs (which downloads the woff2 files) read this one file,
// so a font is declared in exactly one place. To change a weight/style/family:
//   1. edit the spec below
//   2. run `bun run vendor-fonts`  (re-downloads the committed woff2)
//   3. commit the changed src/assets/fonts/*.woff2
// CI enforces step 2/3 (see the "font drift" check in .github/workflows/test.yaml),
// so a forgotten regeneration fails the build rather than shipping stale fonts.
//
// Why `local` instead of the google provider: the files are committed, so the
// production build (deploy.yaml / lighthouse.yaml) never fetches from Google at
// build time. Same reasoning as self-hosting the DuckDB engine (src/worker.ts):
// no third-party origin on the critical path. Astro still generates the
// metric-adjusted fallbacks from the local files, so CLS on swap stays ~0.

// Latin only: all data on the site (town names, romanized addresses) is ASCII.
export const SUBSET = 'latin';

// Directory (relative to web/) holding the committed woff2 files.
export const FONTS_DIR = 'src/assets/fonts';

// Weights/styles are trimmed to exactly what src/styles/global.css uses. Adding a
// new weight/style in CSS means adding it here too (and re-running vendor-fonts).
export const families = [
  {
    googleName: 'Newsreader',
    cssVariable: '--font-newsreader',
    fallbacks: ['Georgia', 'serif'],
    weights: [600],
    styles: ['normal', 'italic'],
  },
  {
    // The logo wordmark ("hdb kaki") is set in Quicksand Bold; the nav brand text
    // uses this to match it (src/components/Nav.astro + the .brand rule in
    // src/styles/global.css).
    googleName: 'Quicksand',
    cssVariable: '--font-brand',
    fallbacks: ['sans-serif'],
    weights: [700],
    styles: ['normal'],
  },
  {
    googleName: 'Public Sans',
    cssVariable: '--font-sans',
    fallbacks: ['sans-serif'],
    weights: [400, 500, 600, 700],
    styles: ['normal'],
  },
  {
    googleName: 'IBM Plex Mono',
    cssVariable: '--font-mono',
    fallbacks: ['monospace'],
    weights: [400, 500, 600],
    styles: ['normal'],
  },
];

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Deterministic path (relative to web/) for one variant's woff2 file. */
export function variantFile(googleName, weight, style) {
  return `${FONTS_DIR}/${slug(googleName)}-${weight}-${style}-${SUBSET}.woff2`;
}

/** Expand a family into its {weight, style} variants. */
export function variantsOf(family) {
  const out = [];
  for (const weight of family.weights) {
    for (const style of family.styles) out.push({ weight, style });
  }
  return out;
}

/** Build the `options.variants` array astro.config passes to fontProviders.local(). */
export function localVariants(family) {
  return variantsOf(family).map(({ weight, style }) => ({
    weight,
    style,
    src: ['./' + variantFile(family.googleName, weight, style)],
  }));
}
