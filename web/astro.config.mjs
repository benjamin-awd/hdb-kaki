import { defineConfig, fontProviders } from 'astro/config';
import { readFileSync } from 'node:fs';
import { families as fontFamilies, localVariants } from './fonts.spec.mjs';

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
  // Self-hosted, subsetted fonts via Astro's experimental Fonts API, replacing the
  // render-blocking, cross-origin Google Fonts <link> that used to live in Base.astro.
  // Faces are served from our own origin (immutable caching in public/_headers) and
  // Astro generates metric-adjusted fallbacks so the swap causes ~no layout shift.
  //
  // Uses the `local` provider over committed woff2 files (see fonts.spec.mjs, the
  // single source of truth). The production build therefore NEVER fetches from Google;
  // scripts/vendor-fonts.mjs downloads the files on demand (`bun run vendor-fonts`).
  //
  // NB: the @font-face family names Astro emits are hashed (e.g. "Fraunces-<hash>"),
  // so fonts are reachable ONLY through the cssVariable. All CSS and ECharts
  // fontFamily strings reference var(--font-*), never the literal family name.
  experimental: {
    fonts: fontFamilies.map((f) => ({
      provider: fontProviders.local(),
      name: f.googleName,
      cssVariable: f.cssVariable,
      fallbacks: f.fallbacks,
      options: { variants: localVariants(f) },
    })),
  },
  vite: {
    define: {
      'import.meta.env.PUBLIC_DUCKDB_VERSION': JSON.stringify(duckdbVersion),
    },
    plugins: [duckdbDevFallback],
  },
});
