import { defineConfig, fontProviders } from 'astro/config';
import { families as fontFamilies, localVariants } from './fonts.spec.mjs';

// Static output (default). Host-agnostic build → deployable to Cloudflare
// Workers, GitHub Pages, etc. See wireframes/REBUILD_PLAN.md.
export default defineConfig({
  site: 'https://app.hdb-kaki.workers.dev',
  // Nav links are plain <a>; prefetch warms the next page on hover so cross-page
  // nav feels instant. prefetchAll opts every internal link in by default — the two
  // heavy map pages opt back out with data-astro-prefetch="false" in Nav.astro.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  experimental: {
    // Self-hosted, subsetted fonts via Astro's experimental Fonts API, replacing the
    // render-blocking, cross-origin Google Fonts <link> that used to live in Base.astro.
    // Faces are served from our own origin (immutable caching in public/_headers) and
    // Astro generates metric-adjusted fallbacks so the swap causes ~no layout shift.
    //
    // Uses the `local` provider over committed woff2 files (see fonts.spec.mjs, the
    // single source of truth). The production build therefore NEVER fetches from Google;
    // scripts/vendor-fonts.mjs downloads the files on demand (`bun run vendor-fonts`).
    //
    // NB: the @font-face family names Astro emits are hashed (e.g. "Newsreader-<hash>"),
    // so fonts are reachable ONLY through the cssVariable. All CSS and ECharts
    // fontFamily strings reference var(--font-*), never the literal family name.
    fonts: fontFamilies.map((f) => ({
      provider: fontProviders.local(),
      name: f.googleName,
      cssVariable: f.cssVariable,
      fallbacks: f.fallbacks,
      options: { variants: localVariants(f) },
    })),
    // Upgrade hover-prefetch to a full client-side prerender via the Speculation Rules
    // API, so an opted-in link renders before the click. Pairs with the hyparquet
    // worker's "warm on idle" priming — which is gated behind document.prerendering
    // (see hyparquetClient.warmWhenIdle) so a hover can't spin up the worker + decode
    // the parquet for a page never visited; the Leaflet map pages are excluded from
    // prefetch entirely.
    clientPrerender: true,
  },
});
