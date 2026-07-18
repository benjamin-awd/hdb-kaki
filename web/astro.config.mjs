import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

// Read straight from the installed package's manifest so the version can never
// drift from what upload-duckdb-r2.mjs pushes to R2. Exposed to client code as
// import.meta.env.PUBLIC_DUCKDB_VERSION, which src/lib/duckdbBundle.ts uses to
// build the version-pinned /duckdb/<version>/ URLs.
const duckdbVersion = JSON.parse(
  readFileSync(new URL('./node_modules/@duckdb/duckdb-wasm/package.json', import.meta.url), 'utf8'),
).version;

// `astro dev` doesn't run src/worker.ts, so /duckdb/* would 404 locally. Mirror the
// Worker's jsDelivr fallback here so the engine loads in dev exactly as it does in
// production before R2 is populated. Key format matches: "/duckdb/<version>/<file>".
const duckdbDevFallback = {
  name: 'duckdb-dev-fallback',
  configureServer(server) {
    server.middlewares.use('/duckdb', (req, res) => {
      const key = (req.url ?? '').replace(/^\//, '').split('?')[0]; // "<version>/<file>"
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
  vite: {
    define: {
      'import.meta.env.PUBLIC_DUCKDB_VERSION': JSON.stringify(duckdbVersion),
    },
    plugins: [duckdbDevFallback],
  },
});
