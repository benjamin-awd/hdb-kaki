// Browser Web Worker entry (NOT a Cloudflare Worker — just a hashed JS chunk under
// /_astro/, served as a static asset; Cloudflare never executes it). It hosts the resident
// hyparquet engine: createEngine() decodes resale.parquet and holds the ~236k-row array
// here, off the main thread, so filtering/aggregation never blocks the UI.
//
// One engine instance serves everything. As a SharedWorker it is shared across every
// same-origin document, so the parquet is decoded ONCE PER SESSION and reused across
// navigations/tabs; as a dedicated Worker (the fallback path) it serves this one page.
import * as Comlink from 'comlink';
import { createEngine } from './hyparquetCore';

const engine = createEngine();

if ('onconnect' in globalThis) {
  // SharedWorker: expose the shared engine on each connecting document's port.
  (globalThis as unknown as { onconnect: (e: MessageEvent) => void }).onconnect = (e) => {
    const port = e.ports[0];
    Comlink.expose(engine, port);
    port.start();
  };
} else {
  // Dedicated Worker fallback.
  Comlink.expose(engine);
}
