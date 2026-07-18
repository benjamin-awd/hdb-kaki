// Download the exact latin-subset woff2 files declared in fonts.spec.mjs from the
// Google Fonts CSS2 API and write them into web/src/assets/fonts/ (committed to git).
//
// This is the ONLY step that talks to Google, and it runs on demand (`bun run
// vendor-fonts`), never during the production build. The build consumes the
// committed files via the `local` provider, so deploy/lighthouse have no
// build-time dependency on fonts.googleapis.com.
//
// Idempotent: re-running with an unchanged spec reproduces byte-identical files
// (Google serves stable, versioned URLs), so the CI drift check stays green.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { families, variantFile, variantsOf, SUBSET, FONTS_DIR } from '../fonts.spec.mjs';

// A desktop-Chrome UA so the CSS2 API returns woff2 (older UAs get ttf/woff).
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// One CSS2 request per (family, weight, style). Requesting a single variant keeps
// the response to one @font-face block per subset, so picking `latin` is unambiguous.
function cssUrl(googleName, weight, style) {
  const family = googleName.replace(/ /g, '+');
  // Axis tuples must be sorted; italic uses the `ital` axis (0 = roman, 1 = italic).
  const axis = style === 'italic' ? `ital,wght@1,${weight}` : `wght@${weight}`;
  return `https://fonts.googleapis.com/css2?family=${family}:${axis}&display=swap`;
}

// Pull the woff2 URL out of the `/* latin */` @font-face block of a CSS2 response.
function latinWoff2Url(css, label) {
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1] !== SUBSET) continue;
    const url = m[2].match(/url\((https:\/\/[^)]+\.woff2)\)/);
    if (url) return url[1];
  }
  throw new Error(`no ${SUBSET} woff2 block found for ${label}`);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Download everything FIRST, into memory. Only if every fetch succeeds do we touch
// the disk — so a network failure never leaves the committed fonts half-deleted.
const downloaded = [];
for (const family of families) {
  for (const { weight, style } of variantsOf(family)) {
    const label = `${family.googleName} ${weight} ${style}`;
    const css = await fetchText(cssUrl(family.googleName, weight, style));
    const buf = await fetchBuffer(latinWoff2Url(css, label));
    downloaded.push({ label, rel: variantFile(family.googleName, weight, style), buf });
  }
}

// Rewrite the directory from scratch so a variant removed from the spec doesn't linger.
const outDir = join(webRoot, FONTS_DIR);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

let total = 0;
for (const { label, rel, buf } of downloaded) {
  await writeFile(join(webRoot, rel), buf);
  total += buf.length;
  console.log(`${label.padEnd(28)} ${(buf.length / 1024).toFixed(1).padStart(6)} KiB  ${rel}`);
}
console.log(`\nVendored ${SUBSET}-subset fonts -> ${FONTS_DIR}  (${(total / 1024).toFixed(1)} KiB total)`);
