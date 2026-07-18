// Single source of truth for the self-hosted DuckDB-WASM bundle URLs.
//
// The engine (~34 MiB of .wasm plus its worker) is copied out of node_modules
// into public/duckdb/<version>/ at build time by scripts/copy-duckdb.mjs and
// served from our own origin — so Cloudflare caches it immutably and pages can
// prefetch it, instead of streaming it cross-origin from jsDelivr. The version is
// injected from the installed @duckdb/duckdb-wasm package by astro.config.mjs
// (PUBLIC_DUCKDB_VERSION), so this path can never drift from what was copied.
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
