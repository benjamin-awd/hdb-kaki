import { defineConfig } from 'astro/config';

// Static output (default). Host-agnostic build → deployable to Cloudflare
// Workers, GitHub Pages, etc. See wireframes/REBUILD_PLAN.md.
export default defineConfig({
  site: 'https://app.hdb-kaki.workers.dev',
});
