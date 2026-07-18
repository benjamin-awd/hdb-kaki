import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

// Read straight from the installed package's manifest so the version can never
// drift from what scripts/compress-duckdb.mjs stages for the build. Exposed to
// client code as import.meta.env.PUBLIC_DUCKDB_VERSION, which src/lib/duckdbBundle.ts
// uses to build the version-pinned /duckdb/<version>/ URLs.
const duckdbVersion = JSON.parse(
  readFileSync(new URL('./node_modules/@duckdb/duckdb-wasm/package.json', import.meta.url), 'utf8'),
).version;

// `astro dev` doesn't run src/worker.ts, so /duckdb/* would 404 locally (the build
// only emits the compressed `<file>.br`, not the `<file>.wasm` the client requests).
// Mirror the Worker's jsDelivr fallback here so the engine loads in dev exactly as
// its production fallback does. Key format matches: "/duckdb/<version>/<file>".
const duckdbDevFallback = {
  name: 'duckdb-dev-fallback',
  configureServer(server) {
    server.middlewares.use('/duckdb', (req, res) => {
      const key = (req.url ?? '').replace(/^\//, '').split('?')[0]; // "<version>/<file>"
      // Extension requests (…/ext/<core>/<platform>/<name>) go upstream to the DuckDB
      // extension repo, matching src/worker.ts's fallback.
      const extIdx = key.indexOf('/ext/');
      if (extIdx !== -1) {
        res.statusCode = 302;
        res.setHeader('Location', `https://extensions.duckdb.org/${key.slice(extIdx + '/ext/'.length)}`);
        return res.end();
      }
      const slash = key.indexOf('/');
      if (slash === -1) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      const version = key.slice(0, slash);
      const file = key.slice(slash + 1);
      res.statusCode = 302;
      res.setHeader('Location', `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${version}/dist/${file}`);
      res.end();
    });
  },
};

// Static output (default). Host-agnostic build → deployable to Cloudflare
// Workers, GitHub Pages, etc. See wireframes/REBUILD_PLAN.md.
export default defineConfig({
  site: 'https://app.hdb-kaki.workers.dev',
  // Nav links are plain <a>; prefetch warms the next page on hover so cross-page
  // nav feels instant. prefetchAll opts every internal link in by default — the two
  // heavy map pages opt back out with data-astro-prefetch="false" in Nav.astro.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  // Upgrade hover-prefetch to a full client-side prerender via the Speculation Rules
  // API, so an opted-in link renders before the click. Pairs with the "warm on idle"
  // engine priming — but the DuckDB warm on / and /psf-trends is gated behind
  // document.prerendering so a hover can't pull the ~4.7 MB wasm for a page never
  // visited, and the Leaflet map pages are excluded from prefetch entirely.
  experimental: { clientPrerender: true },
  vite: {
    define: {
      'import.meta.env.PUBLIC_DUCKDB_VERSION': JSON.stringify(duckdbVersion),
    },
    plugins: [duckdbDevFallback],
  },
});
