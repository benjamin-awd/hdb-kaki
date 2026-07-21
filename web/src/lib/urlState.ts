// Deep-linkable filter state for the interactive pages.
//
// Two layers, deliberately split:
//   1. A *pure codec* (encode/decode/deviates) that only touches strings and
//      URLSearchParams — unit-tested with no globals.
//   2. A *DOM-binding layer* (control factories + createUrlState) that reads/writes
//      `document`/`history`/`location`, but ONLY when its functions are called, never at
//      import time. This mirrors duckdbClient.ts's import-safety contract, and is kept out
//      of that module so the codec stays free of the lazy 4.7 MB engine import (a JS-free
//      cold load must be able to answer "do these params deviate from the snapshot
//      default?" without pulling DuckDB in).
//
// The query keys are the shareable contract: freeze them, changing one breaks old links.

export type ParamValues = Record<string, string>;

// ---- pure codec -----------------------------------------------------------------

/**
 * Encode `values` into a query string, omitting any value equal to its default (so a
 * default/"all" view produces an empty string and stays JS-free-eligible). Keys are
 * emitted in `order` for stable, testable output. Uses URLSearchParams, so a space in a
 * value round-trips as `+` (`4 ROOM` ⇄ `4+ROOM`). Returns `''` or `?a=1&b=2`.
 */
export function encodeParams(values: ParamValues, defaults: ParamValues, order: string[]): string {
  const params = new URLSearchParams();
  for (const key of order) {
    const v = values[key];
    if (v == null || v === '' || v === defaults[key]) continue;
    params.set(key, v);
  }
  const qs = params.toString();
  return qs ? '?' + qs : '';
}

/**
 * Decode `search` (e.g. `location.search`) into a full value map: start from `defaults`
 * and override only known keys that are present and non-empty. Unknown/garbage keys are
 * ignored; an empty value is treated as absent (keeps the default).
 */
export function decodeParams(search: string, defaults: ParamValues): ParamValues {
  const params = new URLSearchParams(search);
  const out: ParamValues = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const v = params.get(key);
    if (v != null && v !== '') out[key] = v;
  }
  return out;
}

/**
 * The "should we boot DuckDB?" gate: true iff any known key in `search` is present,
 * non-empty, and differs from its default. All-default (or empty) search → false.
 */
export function deviatesFromDefaults(search: string, defaults: ParamValues): boolean {
  const params = new URLSearchParams(search);
  for (const key of Object.keys(defaults)) {
    const v = params.get(key);
    if (v != null && v !== '' && v !== defaults[key]) return true;
  }
  return false;
}

// ---- DOM-binding layer ----------------------------------------------------------

/** One filter's link between the URL and a page control. `read`/`write` touch the DOM. */
export interface ControlBinding {
  key: string;
  default: string;
  read(): string;
  write(v: string): void;
}

const sel = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

/** Bind a `<select>` by id. `write` only takes effect once its options exist. */
export function selectBinding(id: string, key: string, def: string): ControlBinding {
  return {
    key,
    default: def,
    read: () => sel(id)?.value ?? def,
    write: (v) => {
      sel(id).value = v;
    },
  };
}

/** Bind a text/number `<input>` by id. */
export function inputBinding(id: string, key: string, def: string): ControlBinding {
  return {
    key,
    default: def,
    read: () => sel(id)?.value ?? def,
    write: (v) => {
      sel(id).value = v;
    },
  };
}

/**
 * Bind a chip group: read the `data-<dataAttr>` of the `.on` chip, and on write move the
 * `.on` class to the chip whose `data-<dataAttr>` matches. `groupSel` selects the group
 * container; chips are its `[data-<dataAttr>]` descendants.
 */
export function chipBinding(
  groupSel: string,
  key: string,
  dataAttr: string,
  def: string,
): ControlBinding {
  const group = () => document.querySelector(groupSel);
  return {
    key,
    default: def,
    read: () => {
      const on = group()?.querySelector<HTMLElement>('.on');
      return on?.dataset[dataAttr] ?? def;
    },
    write: (v) => {
      group()
        ?.querySelectorAll<HTMLElement>(`[data-${dataAttr}]`)
        .forEach((c) => c.classList.toggle('on', c.dataset[dataAttr] === v));
    },
  };
}

/** Bind derived state that has no DOM control of its own (e.g. a pager index). */
export function stateBinding(
  key: string,
  get: () => string,
  set: (v: string) => void,
  def: string,
): ControlBinding {
  return { key, default: def, read: get, write: set };
}

export interface UrlState {
  /** Default value per key — the snapshot-matching baseline. */
  defaults: ParamValues;
  /** Do the given params (default: `location.search`) deviate from the defaults? */
  deviates(search?: string): boolean;
  /** Write bindings' values from the URL. `only`/`skip` restrict which keys are applied. */
  restore(opts?: { only?: string[]; skip?: string[] }): void;
  /** Write a single binding's value from the URL (for deferred, async-populated controls). */
  applyKey(key: string): void;
  /** Push the current control values into the URL via replaceState (no history entry). */
  sync(): void;
  /** The relative URL (path + query + hash) that sync() would write. */
  currentUrl(): string;
}

/**
 * Wire a set of bindings to the URL. `order` fixes the query-key order (defaults to the
 * binding order). sync() uses replaceState — never pushState — so filter tweaks don't
 * flood the back stack; location.pathname already carries BASE_URL.
 */
export function createUrlState(bindings: ControlBinding[], order?: string[]): UrlState {
  const byKey = new Map(bindings.map((b) => [b.key, b]));
  const defaults: ParamValues = {};
  for (const b of bindings) defaults[b.key] = b.default;
  const keyOrder = order ?? bindings.map((b) => b.key);

  const readAll = (): ParamValues => {
    const v: ParamValues = {};
    for (const b of bindings) v[b.key] = b.read();
    return v;
  };
  const qs = () => encodeParams(readAll(), defaults, keyOrder);

  return {
    defaults,
    deviates: (search = location.search) => deviatesFromDefaults(search, defaults),
    restore: ({ only, skip } = {}) => {
      const decoded = decodeParams(location.search, defaults);
      for (const b of bindings) {
        if (only && !only.includes(b.key)) continue;
        if (skip && skip.includes(b.key)) continue;
        b.write(decoded[b.key]);
      }
    },
    applyKey: (key) => {
      const b = byKey.get(key);
      if (b) b.write(decodeParams(location.search, defaults)[key]);
    },
    sync: () => history.replaceState(null, '', location.pathname + qs() + location.hash),
    currentUrl: () => location.pathname + qs() + location.hash,
  };
}
