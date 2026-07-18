// Entry Worker for the otherwise assets-only site. It exists for ONE reason: to
// serve the DuckDB-WASM engine at same-origin `/duckdb/<version>/<file>`.
//
// The raw engine is 34-39 MiB — over Cloudflare's 25 MiB static-asset cap, so it
// can't ship as a plain asset. Instead scripts/compress-duckdb.mjs brotli-compresses
// it to ~4.4 MiB (well under the cap) and ships THAT as `<file>.wasm.br`. This Worker
// serves it back with the `Content-Encoding: br` and `Content-Type: application/wasm`
// that WebAssembly.instantiateStreaming needs — set in code, so we don't depend on
// Cloudflare's asset layer honouring a hand-rolled Content-Encoding. See
// src/lib/duckdbBundle.ts for the URL scheme.
//
// Every other request is a static asset served before this Worker runs; we only see
// the engine requests and 404 misses, which we forward to env.ASSETS untouched.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// Minimal shapes for the Workers-runtime bits the DOM lib doesn't declare, so we
// avoid pulling in @cloudflare/workers-types for a ~70-line Worker.
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
// `encodeBody: "manual"` tells the runtime the body is ALREADY in its final encoding
// — don't re-compress it. Without this, Workers gzip-wraps our brotli bytes and the
// browser hands garbage to WebAssembly. Not in the DOM lib's ResponseInit.
interface CfResponseInit extends ResponseInit {
  encodeBody?: 'automatic' | 'manual';
}

// no-transform belts-and-braces against any further edge recompression.
const IMMUTABLE = 'public, max-age=31536000, immutable, no-transform';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/duckdb/')) {
      return serveEngine(request, url, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};

// Serve `/duckdb/<version>/<file>`, cached at the edge and immutably in the browser.
// `.wasm` comes from the brotli-compressed `<file>.br` asset; workers/other files are
// small and pass through as-is. Missing assets fall back to jsDelivr so the engine
// still loads if a build ever skipped the compress step.
async function serveEngine(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  let res: Response;
  if (url.pathname.endsWith('.wasm')) {
    // Fetch the pre-compressed twin with a bare GET so the asset layer returns the
    // raw brotli bytes rather than trying to re-encode them.
    const asset = await env.ASSETS.fetch(new Request(`${url.origin}${url.pathname}.br`));
    if (!asset.ok) return jsdelivrFallback(url.pathname);
    res = new Response(asset.body, {
      encodeBody: 'manual',
      headers: {
        'Content-Type': 'application/wasm',
        'Content-Encoding': 'br',
        'Cache-Control': IMMUTABLE,
      },
    } as CfResponseInit);
  } else {
    const asset = await env.ASSETS.fetch(request);
    if (!asset.ok) return jsdelivrFallback(url.pathname);
    const headers = new Headers(asset.headers); // mutable copy; asset's are guarded
    headers.set('Cache-Control', IMMUTABLE);
    res = new Response(asset.body, { status: asset.status, headers });
  }

  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

// "/duckdb/<version>/<file>" mirrors the npm layout -> jsDelivr's
// "@<version>/dist/<file>". A 302 keeps the browser's fetch flowing; instantiation
// follows redirects transparently.
function jsdelivrFallback(pathname: string): Response {
  const key = pathname.slice('/duckdb/'.length); // "<version>/<file>"
  const slash = key.indexOf('/');
  if (slash === -1) return new Response('Not found', { status: 404 });
  const version = key.slice(0, slash);
  const file = key.slice(slash + 1);
  return Response.redirect(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${version}/dist/${file}`, 302);
}
