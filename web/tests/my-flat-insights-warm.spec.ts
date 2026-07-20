import { test, expect } from '@playwright/test';

// Guards the My Flat Insights load behaviour after the warm was simplified. The page
// dropped its auto-loaded default valuation, so nothing queries DuckDB on load; the ONLY
// trigger for booting the engine is the idle-time `warmEngineWhenIdle()` in the page script.
// The old `focus`-triggered warm listener was removed: the postal field now autofocuses on
// load, so a focus listener would warm eagerly for everyone, including Save-Data users (via
// the full buffered download). These tests pin what must stay true: the engine still warms
// on load, unprompted, and the cursor lands in the postal field so the first action is obvious.
test('warms the DuckDB engine on load, with no interaction', async ({ page }) => {
  const wasmReq = page.waitForRequest(/\/duckdb\/.*\/duckdb-eh\.wasm$/, { timeout: 45_000 });
  const manifestReq = page.waitForRequest(/\/data\/manifest\.json$/, { timeout: 45_000 });
  const parquetReq = page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });

  await page.goto('/my-flat-insights/');
  // Deliberately NO clicks or typing — the eager prefetch() must warm on its own.

  // Engine wasm requested (prefetch -> getConn -> boot -> instantiate), served 200 from
  // our own worker as application/wasm (not a redirect to the jsDelivr fallback).
  const req = await wasmReq;
  const res = await req.response();
  expect(res, 'engine wasm should get a response').not.toBeNull();
  expect(res!.status()).toBe(200);
  expect(res!.url()).toContain('/duckdb/');
  expect(res!.headers()['content-type']).toBe('application/wasm');

  // manifest.json is fetched only from inside boot(), so this proves a real boot ran; the
  // parquet fetch (buffered warm) confirms the data file came down end-to-end.
  await manifestReq;
  await parquetReq;
});

test('autofocuses the postal field so the first action is obvious', async ({ page }) => {
  await page.goto('/my-flat-insights/');
  await expect(page.locator('#f-postal')).toBeFocused();
});
