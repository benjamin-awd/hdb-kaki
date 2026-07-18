// Single source of truth for the self-hosted DuckDB-WASM bundle URLs.
//
// The engine (~34 MiB of .wasm plus its worker) is staged into
// public/duckdb/<version>/ at build time by scripts/compress-duckdb.mjs, which
// brotli-compresses the .wasm to ~4.5 MiB (under Cloudflare's 25 MiB static-asset
// cap); src/worker.ts re-serves it same-origin with Content-Encoding: br. Serving
// from our own origin lets Cloudflare cache it immutably and pages prefetch it,
// instead of streaming it cross-origin from jsDelivr. The version is injected from
// the installed @duckdb/duckdb-wasm package by astro.config.mjs
// (PUBLIC_DUCKDB_VERSION), so this path can never drift from what was staged.
const VERSION = import.meta.env.PUBLIC_DUCKDB_VERSION;

/** Root-relative dir holding this version's bundle files, e.g. `/duckdb/1.29.0/`. */
export function duckdbBase(base: string = import.meta.env.BASE_URL): string {
  return `${base}duckdb/${VERSION}/`;
}

/**
 * URL of the exception-handling wasm module — the bundle selectBundle() picks on
 * every browser we support. Pages `<link rel="prefetch">` this to warm the HTTP
 * cache before the first query spins up the engine.
 */
export function ehWasmUrl(base?: string): string {
  return `${duckdbBase(base)}duckdb-eh.wasm`;
}
