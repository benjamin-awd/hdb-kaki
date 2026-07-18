// Client-side data layer: DuckDB-WASM over the single Parquet file in /data.
// Lazily boots the WASM engine, registers resale.parquet from manifest.json, and
// exposes a typed query() helper. Runs entirely in the browser — no backend.
import * as duckdb from '@duckdb/duckdb-wasm';
import { duckdbBase } from './duckdbBundle';

export interface Manifest {
  lastUpdated: string | null;
  rows: number;
  file: string;
  bytes: number;
  columns: string[];
}

let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;
let manifestPromise: Promise<Manifest> | null = null;

export function getManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${import.meta.env.BASE_URL}data/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`manifest.json ${r.status}`);
      return r.json();
    });
  }
  return manifestPromise;
}

async function boot(): Promise<duckdb.AsyncDuckDBConnection> {
  // Self-hosted engine served same-origin by src/worker.ts, which re-serves the
  // brotli-compressed .wasm with Content-Encoding: br (see src/lib/duckdbBundle.ts).
  // selectBundle picks eh vs. mvp from browser features;
  // both are absolute URLs so the blob worker's importScripts resolves them.
  const dir = new URL(duckdbBase(), window.location.href).href;
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: `${dir}duckdb-mvp.wasm`, mainWorker: `${dir}duckdb-browser-mvp.worker.js` },
    eh: { mainModule: `${dir}duckdb-eh.wasm`, mainWorker: `${dir}duckdb-browser-eh.worker.js` },
  });
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  const manifest = await getManifest();
  const base = new URL(`${import.meta.env.BASE_URL}data/`, window.location.href).href;
  await db.registerFileURL(manifest.file, base + manifest.file, duckdb.DuckDBDataProtocol.HTTP, false);

  const conn = await db.connect();
  // Query the file as `resale`. DuckDB reads it lazily over HTTP range requests.
  await conn.query(`CREATE VIEW resale AS SELECT * FROM read_parquet('${manifest.file}')`);
  return conn;
}

function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    const p = boot();
    // Don't cache a failed boot for the rest of the session: if a transient error
    // (wasm/worker/manifest/parquet fetch) rejects it, drop the cached promise so
    // the next getConn() retries instead of re-throwing the same rejection forever.
    p.catch(() => {
      if (connPromise === p) connPromise = null;
    });
    connPromise = p;
  }
  return connPromise;
}

/**
 * Eagerly boot the engine (download + instantiate + register shards + create the
 * `resale` view) so the first query() resolves instantly. Pages that render a
 * default view on load call this to overlap the WASM download with DOM wiring.
 * Idempotent — reuses the cached connection; boot errors are swallowed here and
 * surface on the actual query() instead.
 */
export function prefetch(): void {
  void getConn().catch(() => {});
}

/** Run SQL against the `resale` view and return plain JS row objects. */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const result = await conn.query(sql);
  return result.toArray().map((r) => r.toJSON() as T);
}
