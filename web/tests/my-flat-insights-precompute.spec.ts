import { test, expect } from '@playwright/test';

// Guards the precompute path on My Flat Insights. The postal→block shards
// (web/public/data/flat-index/<pp>.json) plus the town×flat aggregates + comps
// (flat-aggregates.json) let the form resolve and the FULL valuation + charts render
// without the 4.7 MB DuckDB engine; the engine then boots in the background only for the
// comps table, map and priciest/lowest-sale tiles. The shard for the typed prefix is
// prefetched as the first digits are keyed in. See webapp/update/emit_web.py
// (emit_flat_index / emit_flat_aggregates) and renderStatic()/renderValuation() in the page.

test('renders the valuation from the precompute with the DuckDB engine blocked', async ({
  page,
}) => {
  // Block the engine outright — if the valuation still appears, it cannot depend on it.
  await page.route(/\/duckdb\/.*\.wasm$/, (r) => r.abort());

  // Derive a real, resolvable postal from a stable, populous shard (Punggol, prefix 82) so
  // the test doesn't hardcode a specific number that a future ETL run might drop.
  const shard = await (await page.request.get('/data/flat-index/82.json')).json();
  const postal = Object.keys(shard).find((p) => Object.keys(shard[p].ft).length);
  expect(postal, 'shard 82 should contain a resolvable postal').toBeTruthy();

  await page.goto('/my-flat-insights/');
  await page.locator('#f-postal').fill(postal!.padStart(6, '0'));
  await page.locator('#f-postal').blur(); // fire 'change' -> resolveBlock + renderStatic

  // Headline estimate, its range, a benchmark bar and the percentile pill all come from the
  // precompute — they must render even though the engine is blocked.
  await expect(page.locator('#val-big')).toHaveText(/\$[\d,]+/, { timeout: 15_000 });
  await expect(page.locator('#val-low')).toHaveText(/\$[\d,]+/);
  await expect(page.locator('#b1-v')).toHaveText(/\$\d/);
  await expect(page.locator('#pctile-pill')).toHaveText(/percentile/);
  // The block resolved from the shard: the postal sub-label shows "<address> · <town>".
  await expect(page.locator('#f-postal-sub')).toContainText('·');
});

test('prefetches the postal shard as the first digits are typed', async ({ page }) => {
  await page.goto('/my-flat-insights/');
  // Two digits are enough to fetch the prefix shard, so resolve is instant once the full
  // postal is entered. waitForRequest catches the request itself (fires even if the shard
  // 404s), so this pins the client behaviour independent of which prefixes have data.
  const shardReq = page.waitForRequest(/\/data\/flat-index\/\d{2}\.json$/, { timeout: 10_000 });
  await page.locator('#f-postal').click();
  await page.keyboard.type('82');
  expect((await shardReq).url()).toMatch(/\/flat-index\/82\.json$/); // matches the typed prefix
});
