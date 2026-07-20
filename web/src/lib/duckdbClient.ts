// Shared client-side scaffolding for the interactive pages' <script> blocks.
//
// The DuckDB-WASM engine (~4.7 MB) must stay OUT of each page's first-paint bundle,
// so it is only ever pulled in via a *dynamic* import('./db'). createQuery() closes
// over that single lazy import so query() and the warm/prefetch helpers all share one
// engine instance and never double-download it. Because these helpers touch DOM /
// browser globals only when called, this module is import-safe in a client script but
// must not be imported into SSR frontmatter.
import { titleCase } from './format';

type DbModule = typeof import('./db');
export type QueryFn = <T = any>(sql: string) => Promise<T[]>;

/** `document.getElementById(id)` with a non-null assertion — the ids are in the template. */
export const byId = (id: string): HTMLElement => document.getElementById(id)!;

/** Escape single quotes for interpolation into a SQL string literal. */
export const sqlEsc = (s: unknown): string => String(s).replace(/'/g, "''");

/**
 * A lazily-booted DuckDB query interface for one page. All three returned functions
 * share the same dynamic import(), so warming and querying reuse a single engine:
 *  - `query(sql)`  — run SQL against the `resale` view (boots the engine on first call).
 *  - `prefetch()`  — boot the engine now (download + instantiate + register), so the
 *                    first query resolves instantly. Idempotent.
 *  - `warmEngineWhenIdle()` — prefetch at idle time, unless Save-Data is on; and, while
 *                    the page is only being speculatively prerendered (from a hover),
 *                    defer the ~4.7 MB download until the prerender is activated.
 */
export function createQuery(): {
  query: QueryFn;
  prefetch: () => void;
  warmEngineWhenIdle: () => void;
} {
  let db: Promise<DbModule> | null = null;
  const load = () => (db ??= import('./db'));

  const query: QueryFn = async <T = any>(sql: string): Promise<T[]> => (await load()).query<T>(sql);

  const prefetch = () => {
    load()
      .then((m) => m.prefetch())
      .catch(() => {});
  };

  const warmEngineWhenIdle = () => {
    if ((navigator as any).connection?.saveData) return;
    const idle: (cb: () => void) => void =
      (window as any).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1500));
    const warm = () => idle(prefetch);
    if ((document as any).prerendering) {
      document.addEventListener('prerenderingchange', warm, { once: true });
    } else {
      warm();
    }
  };

  return { query, prefetch, warmEngineWhenIdle };
}

/** Populate a street `<select>` with an "All streets" option plus one option per street. */
export function setStreets(selectEl: HTMLElement, streets: string[]): void {
  (selectEl as HTMLSelectElement).innerHTML =
    `<option value="__all" selected>All streets</option>` +
    streets.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('');
}

/** Distinct street names in a town, ordered — for the street filter dropdown. */
export async function loadStreets(query: QueryFn, town: string): Promise<string[]> {
  const streets = await query<{ street_name: string }>(
    `SELECT DISTINCT street_name FROM resale WHERE town='${sqlEsc(town)}' ORDER BY street_name`,
  );
  return streets.map((s) => s.street_name);
}
