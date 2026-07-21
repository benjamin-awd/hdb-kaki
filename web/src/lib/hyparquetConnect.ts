// The mockable seam between the main thread and the resident engine. createRemote() connects
// to the Web Worker and wraps it with Comlink. It prefers a SharedWorker — one engine shared
// across every same-origin document, so the parquet is decoded once per session and reused
// across navigations — and degrades to a dedicated Worker, then to running the SAME engine on
// the main thread if neither can be constructed. hyparquetCore is only ever *dynamically*
// imported on that last fallback, so hyparquet + the ZSTD decoder are bundled into the worker
// chunk — not the page's main bundle — on the happy path.
import * as Comlink from 'comlink';
import type { HyparquetApi } from './hyparquetCore';

/** A SharedWorker/Worker-backed HyparquetApi, or a main-thread fallback with the same interface. */
export function createRemote(): HyparquetApi {
  // Preferred: a SharedWorker decodes once and serves every document/tab in the session.
  try {
    if (typeof SharedWorker !== 'undefined') {
      const shared = new SharedWorker(new URL('./hyparquetWorker.ts', import.meta.url), {
        type: 'module',
      });
      shared.port.start();
      return Comlink.wrap<HyparquetApi>(shared.port);
    }
  } catch {
    // fall through to a dedicated worker
  }
  try {
    const worker = new Worker(new URL('./hyparquetWorker.ts', import.meta.url), { type: 'module' });
    return Comlink.wrap<HyparquetApi>(worker);
  } catch {
    // No module-worker support: degrade to the engine on the main thread (functional, but
    // decode + scans run on the render thread). Dynamically imported so the ~91 KB engine
    // isn't pulled into the main bundle unless this path is actually taken.
    let enginePromise: Promise<HyparquetApi> | null = null;
    const engine = () =>
      (enginePromise ??= import('./hyparquetCore').then((m) => m.createEngine()));
    return new Proxy({} as HyparquetApi, {
      get:
        (_t, prop: string) =>
        (...args: unknown[]) =>
          engine().then((e) =>
            (e as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args),
          ),
    });
  }
}
