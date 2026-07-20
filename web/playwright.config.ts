import { defineConfig, devices } from '@playwright/test';

// E2E tests run against the REAL production serving path: `bun run build`
// (compresses the DuckDB engine + emits ./dist) followed by `wrangler dev`, so
// src/worker.ts runs and /duckdb/*.wasm is served brotli'd with Content-Encoding: br
// — exactly as in production. `astro preview` would 404 on the engine (it only
// serves the compressed `.br` asset, not the `.wasm` the client requests).
const PORT = 8788;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `bun run build && bunx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    // Keep wrangler non-interactive in CI (no telemetry / update prompts).
    env: { WRANGLER_SEND_METRICS: 'false', CI: process.env.CI ?? '' },
  },
});
