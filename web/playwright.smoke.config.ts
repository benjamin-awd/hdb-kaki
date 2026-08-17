import { defineConfig, devices } from '@playwright/test';

// Production smoke config: unlike playwright.config.ts (which builds + boots a local
// `wrangler dev` and runs the full E2E suite), this drives the ALREADY-DEPLOYED live
// site. There is NO webServer — tests hit `SMOKE_BASE_URL` over the network — so it
// catches breakage the pre-merge suite can't: the app is rebuilt/redeployed daily
// against fresh ETL data no PR ever sees, plus Cloudflare/edge or third-party outages.
//
// Chromium-only and a small spec (see tests-smoke/) keep it a fast, cheap heartbeat.
// Retries absorb a transient blip (cold edge, a slow tile) so a real regression is what
// reds the run, not noise. Point it elsewhere with SMOKE_BASE_URL=... for a preview URL.
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://app.hdb-kaki.workers.dev';

export default defineConfig({
  testDir: './tests-smoke',
  timeout: 90_000,
  expect: { timeout: 45_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
