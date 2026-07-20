// Client-side data layer: DuckDB-WASM over the single Parquet file in /data.
// Lazily boots the WASM engine, registers resale.parquet from manifest.json, and
// exposes a typed query() helper. Runs entirely in the browser — no backend.
import * as duckdb from '@duckdb/duckdb-wasm';
import { duckdbBase, duckdbExtRepo } from './duckdbBundle';

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

async function boot(buffer: boolean): Promise<duckdb.AsyncDuckDBConnection> {
  // Kick off the manifest fetch up front so it overlaps the (slower) engine
  // download + instantiate below instead of running sequentially after it. On a
  // cold visit this hides the manifest round-trip entirely; awaited later once the
  // engine is ready. (Warm visits get their speed-up from the manifest's
  // stale-while-revalidate cache header instead — see public/_headers.)
  const manifestP = getManifest();

  // On the buffered pre-warm path, start pulling the ~3.4 MB data file as soon as the
  // manifest names it, so the download overlaps the (slower) engine download +
  // instantiate below instead of running serially after it — turning the warm's
  // critical path from (instantiate + data) into max(instantiate, data). priority:'low'
  // keeps it from stealing bandwidth from the more-critical wasm. This lives inside the
  // already-gated warm path (Save-Data / idle / prerender-activation — see the pages'
  // warmEngineWhenIdle), so a hover-prerender never triggers it, and it's a single
  // fetch that boot() awaits directly, so there's no double-download to dedupe.
  const base = new URL(`${import.meta.env.BASE_URL}data/`, window.location.href).href;
  const dataP = buffer
    ? manifestP.then((m) => fetch(base + m.file, { priority: 'low' } as RequestInit))
    : null;
  // If instantiate below throws before we await dataP, keep its (possible) rejection
  // from surfacing as an unhandled rejection; the await further down still sees it.
  void dataP?.catch(() => {});

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

  const manifest = await manifestP;
  if (dataP) {
    // Idle pre-warm path: hand DuckDB the whole ~3.4 MB file (fetched above, in
    // parallel with the engine) so the first user query resolves from memory instead
    // of paying for the per-row-group HTTP range requests that lazy registration would
    // defer to click time. Only the Save-Data-gated warm reaches here (see prefetch()).
    const res = await dataP;
    if (!res.ok) throw new Error(`${manifest.file} ${res.status}`);
    await db.registerFileBuffer(manifest.file, new Uint8Array(await res.arrayBuffer()));
  } else {
    // On-demand boot: register lazily so DuckDB reads only the row-group/column
    // chunks a given query touches via HTTP range requests.
    await db.registerFileURL(
      manifest.file,
      base + manifest.file,
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
  }

  const conn = await db.connect();
  // Autoload the parquet extension from our own origin instead of extensions.duckdb.org
  // (see duckdbExtRepo / src/worker.ts). Must be set before the first read_parquet.
  const extRepo = new URL(duckdbExtRepo(), window.location.href).href;
  await conn.query(`SET custom_extension_repository='${extRepo}'`);
  // Query the file as `resale`. DuckDB reads it lazily over HTTP range requests.
  await conn.query(`CREATE VIEW resale AS SELECT * FROM read_parquet('${manifest.file}')`);
  return conn;
}

function getConn(buffer = false): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    const p = boot(buffer);
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
 *
 * Buffers the whole data file (see boot()): callers gate this behind Save-Data, so
 * the up-front bandwidth is opt-out and buys an instant first query. An on-demand
 * boot triggered by query() before the warm completes stays lazy (range requests).
 */
export function prefetch(): void {
  void getConn(true).catch(() => {});
}

/** Run SQL against the `resale` view and return plain JS row objects. */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const result = await conn.query(sql);
  return result.toArray().map((r) => r.toJSON() as T);
}
