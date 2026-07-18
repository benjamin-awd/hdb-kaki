// Entry Worker for the otherwise assets-only site. It exists for ONE reason: to
// serve the DuckDB-WASM engine at same-origin `/duckdb/<version>/<file>`.
//
// The raw engine is 34-39 MiB — over Cloudflare's 25 MiB static-asset cap, so it
// can't ship as a plain asset. Instead scripts/compress-duckdb.mjs brotli-compresses
// it to ~4.5 MiB (well under the cap) and ships THAT as `<file>.wasm.br`. This Worker
// serves it back with the `Content-Encoding: br` + `Content-Type: application/wasm`
// that WebAssembly.instantiateStreaming needs, using `encodeBody: "manual"` so the
// runtime treats the body as already-encoded and doesn't re-compress it.
//
// NB: we deliberately do NOT run these through the Cache API. The Cache API doesn't
// preserve Content-Encoding / the encodeBody flag, so a cached copy gets served with
// the encoding stripped — the browser then hands raw brotli to WebAssembly and it
// fails to compile. Serving fresh from ASSETS every time keeps the encoding intact
// (ASSETS reads are edge-local and cheap); the browser still caches immutably below.
//
// Every other request is a static asset served before this Worker runs; we only see
// the engine requests and 404 misses, which we forward to env.ASSETS untouched.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// `encodeBody: "manual"` (a Workers ResponseInit extension not in the DOM lib) tells
// the runtime the body is already in its final encoding — don't compress it again.
interface CfResponseInit extends ResponseInit {
  encodeBody?: 'automatic' | 'manual';
}

// no-transform belts-and-braces against any edge recompression of the wasm.
const IMMUTABLE = 'public, max-age=31536000, immutable, no-transform';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/duckdb/')) {
      return serveEngine(request, url, env);
    }
    return env.ASSETS.fetch(request);
  },
};

// `.wasm` comes from the brotli-compressed `<file>.br` asset, re-served with the
// right encoding/type. This covers both the engine and the staged parquet extension
// under /duckdb/<version>/ext/. Other engine files (workers) are small and pass
// through. Missing assets fall back upstream so things still load if a build ever
// skipped the compress step (also covers `wrangler dev` against an empty ./dist).
async function serveEngine(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname.endsWith('.wasm')) {
    // Bare GET so the asset layer returns the raw brotli bytes rather than re-encoding.
    const asset = await env.ASSETS.fetch(new Request(`${url.origin}${url.pathname}.br`));
    if (!asset.ok) return upstreamFallback(url.pathname);
    return new Response(asset.body, {
      encodeBody: 'manual',
      headers: {
        'Content-Type': 'application/wasm',
        'Content-Encoding': 'br',
        'Cache-Control': IMMUTABLE,
      },
    } as CfResponseInit);
  }

  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return upstreamFallback(url.pathname);
  const headers = new Headers(asset.headers); // mutable copy; asset's are guarded
  headers.set('Cache-Control', IMMUTABLE);
  return new Response(asset.body, { status: asset.status, headers });
}

// Graceful fallback if a staged file is missing. Extension requests
// (/duckdb/<version>/ext/<core>/<platform>/<name>) go to the upstream DuckDB
// extension repo; everything else mirrors the npm layout on jsDelivr. A 302 keeps
// the browser's fetch flowing; instantiation follows redirects transparently.
function upstreamFallback(pathname: string): Response {
  const extIdx = pathname.indexOf('/ext/');
  if (extIdx !== -1) {
    const rest = pathname.slice(extIdx + '/ext/'.length); // "<core>/<platform>/<name>"
    return Response.redirect(`https://extensions.duckdb.org/${rest}`, 302);
  }
  const key = pathname.slice('/duckdb/'.length); // "<version>/<file>"
  const slash = key.indexOf('/');
  if (slash === -1) return new Response('Not found', { status: 404 });
  const version = key.slice(0, slash);
  const file = key.slice(slash + 1);
  return Response.redirect(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${version}/dist/${file}`, 302);
}
