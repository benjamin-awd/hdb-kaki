// Browser Web Worker entry (NOT a Cloudflare Worker — just a hashed JS chunk under
// /_astro/, served as a static asset; Cloudflare never executes it). It hosts the resident
// hyparquet engine: createEngine() decodes resale.parquet once and holds the ~236k-row array
// here, off the main thread, so filtering/aggregation never blocks the UI. Comlink exposes
// the engine's async methods; only small summaries cross back to the page.
import * as Comlink from 'comlink';
import { createEngine } from './hyparquetCore';

Comlink.expose(createEngine());
