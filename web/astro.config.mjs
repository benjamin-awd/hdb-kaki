import { defineConfig } from 'astro/config';

// Static output (default). Host-agnostic build → deployable to Cloudflare Pages,
// GitHub Pages, etc. See wireframes/REBUILD_PLAN.md.
export default defineConfig({
  site: 'https://hdb-kaki.pages.dev',
});
