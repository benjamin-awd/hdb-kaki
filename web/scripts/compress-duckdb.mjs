// Stage the DuckDB-WASM engine into public/duckdb/<version>/ for the build.
//
// The raw .wasm modules (34-39 MiB) exceed Cloudflare's 25 MiB static-asset cap, so
// we brotli-compress them to ~4.4 MiB `<file>.br` — comfortably under the cap and an
// ~8x smaller download. src/worker.ts serves those back with Content-Encoding: br.
// The small worker .js files ship as-is (Cloudflare compresses them at the edge).
//
// We also stage the `parquet` extension so read_parquet() doesn't fetch it cross-origin
// from extensions.duckdb.org at runtime (see db.ts SET custom_extension_repository).
//
// Runs as part of `bun run build` (see package.json). The output is gitignored and
// regenerated each build, so it always matches the pinned @duckdb/duckdb-wasm version.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { join, dirname } from 'node:path';

// Underlying DuckDB core version for this @duckdb/duckdb-wasm release. It appears in
// the extension URL (extensions.duckdb.org/<core>/<platform>/…) and MUST match the
// version DuckDB requests at runtime. Bump when upgrading duckdb-wasm; if it's wrong
// the extension download below fails loudly, and at runtime the Worker falls back to
// extensions.duckdb.org so queries keep working regardless.
const DUCKDB_CORE = 'v1.1.1';

const DIST = 'node_modules/@duckdb/duckdb-wasm/dist';
const version = JSON.parse(readFileSync('node_modules/@duckdb/duckdb-wasm/package.json', 'utf8')).version;
const outDir = join('public/duckdb', version);
mkdirSync(outDir, { recursive: true });

// Max quality (q11): compression is a one-time build cost, but the result is cached
// immutably in the browser, so the smaller download pays off on every first visit.
const brotli = (raw) =>
  brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });

const wasm = ['duckdb-eh.wasm', 'duckdb-mvp.wasm'];
for (const f of wasm) {
  const raw = readFileSync(join(DIST, f));
  const br = brotli(raw);
  writeFileSync(join(outDir, `${f}.br`), br);
  console.log(`brotli ${f}: ${(raw.length / 1048576).toFixed(1)} → ${(br.length / 1048576).toFixed(1)} MiB`);
}

const workers = ['duckdb-browser-eh.worker.js', 'duckdb-browser-mvp.worker.js'];
for (const f of workers) copyFileSync(join(DIST, f), join(outDir, f));

// Stage the parquet extension for both bundles at the path DuckDB will request under
// our custom repo: <repo>/<core>/<platform>/parquet.duckdb_extension.wasm. The Worker
// serves the `.br` back with Content-Encoding: br, exactly like the engine .wasm.
// Non-fatal: a build without network still ships; the runtime just falls back to the
// upstream repo (via the Worker) for the extension.
for (const platform of ['wasm_eh', 'wasm_mvp']) {
  const name = 'parquet.duckdb_extension.wasm';
  const url = `https://extensions.duckdb.org/${DUCKDB_CORE}/${platform}/${name}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = Buffer.from(await res.arrayBuffer());
    const dest = join(outDir, 'ext', DUCKDB_CORE, platform, `${name}.br`);
    mkdirSync(dirname(dest), { recursive: true });
    const br = brotli(raw);
    writeFileSync(dest, br);
    console.log(`brotli ${platform}/${name}: ${(raw.length / 1024).toFixed(0)} → ${(br.length / 1024).toFixed(0)} KiB`);
  } catch (err) {
    console.warn(`WARNING: could not stage ${platform} parquet extension (${err.message}); ` +
      'runtime will fall back to extensions.duckdb.org.');
  }
}

console.log(`DuckDB-WASM ${version} (core ${DUCKDB_CORE}) staged → ${outDir}`);
