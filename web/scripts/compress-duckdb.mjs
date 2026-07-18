// Stage the DuckDB-WASM engine into public/duckdb/<version>/ for the build.
//
// The raw .wasm modules (34-39 MiB) exceed Cloudflare's 25 MiB static-asset cap, so
// we brotli-compress them to ~4.4 MiB `<file>.br` — comfortably under the cap and an
// ~8x smaller download. src/worker.ts serves those back with Content-Encoding: br.
// The small worker .js files ship as-is (Cloudflare compresses them at the edge).
//
// Runs as part of `bun run build` (see package.json). The output is gitignored and
// regenerated each build, so it always matches the pinned @duckdb/duckdb-wasm version.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'node_modules/@duckdb/duckdb-wasm/dist';
const version = JSON.parse(readFileSync('node_modules/@duckdb/duckdb-wasm/package.json', 'utf8')).version;
const outDir = join('public/duckdb', version);
mkdirSync(outDir, { recursive: true });

// Max quality (q11): compression is a one-time build cost, but the result is cached
// immutably in the browser, so the smaller download pays off on every first visit.
const wasm = ['duckdb-eh.wasm', 'duckdb-mvp.wasm'];
for (const f of wasm) {
  const raw = readFileSync(join(DIST, f));
  const br = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  writeFileSync(join(outDir, `${f}.br`), br);
  console.log(`brotli ${f}: ${(raw.length / 1048576).toFixed(1)} → ${(br.length / 1048576).toFixed(1)} MiB`);
}

const workers = ['duckdb-browser-eh.worker.js', 'duckdb-browser-mvp.worker.js'];
for (const f of workers) copyFileSync(join(DIST, f), join(outDir, f));

console.log(`DuckDB-WASM ${version} staged → ${outDir}`);
