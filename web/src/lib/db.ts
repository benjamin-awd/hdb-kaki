// Client-side data layer: DuckDB-WASM over the year-sharded Parquet in /data.
// Lazily boots the WASM engine, registers every shard from manifest.json, and
// exposes a typed query() helper. Runs entirely in the browser — no backend.
import * as duckdb from '@duckdb/duckdb-wasm';
import { duckdbBase } from './duckdbBundle';

export interface Manifest {
  lastUpdated: string | null;
  rows: number;
  years: string[];
  shards: { year: string; file: string; rows: number; bytes: number }[];
  columns: string[];
}

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
  // Self-hosted engine served same-origin from R2 via src/worker.ts (see
  // src/lib/duckdbBundle.ts). selectBundle picks eh vs. mvp from browser features;
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
  for (const s of manifest.shards) {
    await db.registerFileURL(s.file, base + s.file, duckdb.DuckDBDataProtocol.HTTP, false);
  }

  const conn = await db.connect();
  // A single view spanning every shard — query `resale` like one table.
  const list = manifest.shards.map((s) => `'${s.file}'`).join(', ');
  await conn.query(`CREATE VIEW resale AS SELECT * FROM read_parquet([${list}])`);
  return conn;
}

function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  // Cache the connection on window, not just a module variable, so the warm engine
  // survives Astro client-side navigations (the module isn't re-run, but this also
  // guards any accidental re-eval). Booting is expensive — one per session only.
  const w = window as unknown as { __duckdbConn?: Promise<duckdb.AsyncDuckDBConnection> };
  if (!w.__duckdbConn) w.__duckdbConn = boot();
  return w.__duckdbConn;
}

/** Run SQL against the `resale` view and return plain JS row objects. */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const result = await conn.query(sql);
  return result.toArray().map((r) => r.toJSON() as T);
}
