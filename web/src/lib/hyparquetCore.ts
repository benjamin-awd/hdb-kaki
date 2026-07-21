// Pure hyparquet data engine — NO DOM, NO Comlink, NO Worker imports. It runs inside the
// browser Web Worker (hyparquetWorker.ts) that owns the decoded data, and doubles as the
// main-thread fallback when module workers are unavailable. Every query function is pure
// (columns + params [+ now] → a small, structured-cloneable summary) so it is directly
// unit-testable and so only summaries — never the ~236k-row dataset — cross the Comlink
// boundary.
//
// The resident dataset is columnar (Structure-of-Arrays): typed arrays for the numeric
// columns and string[] for the rest, instead of ~236k row objects. That packs the numerics
// (no per-object headers / boxed numbers), cuts memory, and gives scans cache locality.
// Queries scan by building an index list, then read columns at those indices.
//
// resale.parquet is ZSTD-compressed (webapp/update/emit_web.py); hyparquet doesn't decode
// ZSTD natively, so we pass the decompressor from hyparquet-compressors (pure JS).
import { parquetReadObjects, type AsyncBuffer } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

interface Manifest {
  file: string;
  lastUpdatedEpoch?: number | null; // cache key: bumps on each ETL run
}

// Uses bare `location` (present in both window and worker scopes — a Worker has no `window`).
// Vite still inlines import.meta.env.BASE_URL in worker chunks.
async function readManifest(): Promise<Manifest> {
  const base = import.meta.env.BASE_URL;
  return fetch(`${base}data/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest.json ${r.status}`);
    return r.json();
  });
}

// One request for the whole (small) file.
async function fetchDataFile(fileName: string): Promise<AsyncBuffer> {
  const base = import.meta.env.BASE_URL;
  const url = new URL(`${base}data/${fileName}`, location.href).href;
  const abuf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${fileName} ${r.status}`);
    return r.arrayBuffer();
  });
  return { byteLength: abuf.byteLength, slice: (s, e) => abuf.slice(s, e) };
}

// ============================ JS aggregation toolkit ============================
// Pure aggregation helpers, kept generic (arrays + accessor fns) so the query functions can
// call them with index arrays + column-reading accessors. Parity target is polars
// (webapp/update/emit_web.py), which the default snapshots are emitted from.

/** Median: quantile 0.5 with midpoint interpolation for even counts. */
export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated quantile of an ALREADY-SORTED ascending array. */
export function quantileSorted(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Bucket items by a key, preserving first-seen key order. */
export function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const a = m.get(k);
    if (a) a.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** arg_max(pick, by): the `pick` value of the item with the greatest `by`. */
export function argMax<T, V>(
  rows: readonly T[],
  by: (r: T) => number | string,
  pick: (r: T) => V,
): V | undefined {
  let best: T | undefined;
  let bestBy: number | string | undefined;
  for (const r of rows) {
    const b = by(r);
    if (bestBy === undefined || b > bestBy) {
      bestBy = b;
      best = r;
    }
  }
  return best === undefined ? undefined : pick(best);
}

/** mode(): the most frequent value (ties → first to reach the top count). */
export function mode<T, V>(rows: readonly T[], pick: (r: T) => V): V | undefined {
  const counts = new Map<V, number>();
  let best: V | undefined;
  let bestN = 0;
  for (const r of rows) {
    const v = pick(r);
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
}

/** A random subset of size n (all items if fewer than n). */
export function sampleN<T>(rows: readonly T[], n: number): T[] {
  if (rows.length <= n) return rows.slice();
  const a = rows.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** `YYYY-MM` for `n` months before `now`. */
export function monthsAgo(n: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Year part of a 'YYYY-MM' month. */
export const yearOf = (month: string): string => month.slice(0, 4);

// ============================== columnar dataset ==============================

/** A resale transaction row — the shape query results and test fixtures are built from. */
export interface ResaleRow {
  month: string;
  town: string;
  address: string;
  street_name: string;
  flat_type: string;
  flat_model: string;
  storey_range: string;
  storey_lower_bound: number;
  floor_area_sqft: number;
  resale_price: number;
  psf: number | null;
  remaining_lease_years: number;
  lease_commence_date: number;
  latitude: number | null;
  longitude: number | null;
  postal: number;
}

/** The resident dataset in Structure-of-Arrays form. Nullable numeric columns (psf,
 * latitude, longitude) store NaN for null — scans test `Number.isNaN`, result-builders map
 * NaN back to 0/null to match the old row-object behaviour. */
export interface Columns {
  n: number;
  month: string[];
  town: string[];
  address: string[];
  street_name: string[];
  flat_type: string[];
  flat_model: string[];
  storey_range: string[];
  storey_lower_bound: Int32Array;
  lease_commence_date: Int32Array;
  postal: Int32Array;
  floor_area_sqft: Float64Array;
  resale_price: Float64Array;
  remaining_lease_years: Float64Array;
  psf: Float64Array; // NaN = null
  latitude: Float64Array; // NaN = null
  longitude: Float64Array; // NaN = null
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const f64 = (v: unknown): number => (v == null ? NaN : Number(v)); // null → NaN

/** Transpose decoded rows into columnar typed arrays, coercing as it goes. Accepts the raw
 * objects hyparquet produces (int64 columns are BigInt, nullable cells are null) as well as
 * already-typed ResaleRow fixtures — a single pass builds the columns, no ResaleRow[] middle
 * step. int64 → number happens here, so only plain numbers/strings live in the columns. */
export function toColumns(rows: readonly ResaleRow[]): Columns {
  const n = rows.length;
  const c: Columns = {
    n,
    month: new Array(n),
    town: new Array(n),
    address: new Array(n),
    street_name: new Array(n),
    flat_type: new Array(n),
    flat_model: new Array(n),
    storey_range: new Array(n),
    storey_lower_bound: new Int32Array(n),
    lease_commence_date: new Int32Array(n),
    postal: new Int32Array(n),
    floor_area_sqft: new Float64Array(n),
    resale_price: new Float64Array(n),
    remaining_lease_years: new Float64Array(n),
    psf: new Float64Array(n),
    latitude: new Float64Array(n),
    longitude: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const r = rows[i] as unknown as Record<string, unknown>;
    c.month[i] = str(r.month);
    c.town[i] = str(r.town);
    c.address[i] = str(r.address);
    c.street_name[i] = str(r.street_name);
    c.flat_type[i] = str(r.flat_type);
    c.flat_model[i] = str(r.flat_model);
    c.storey_range[i] = str(r.storey_range);
    c.storey_lower_bound[i] = Number(r.storey_lower_bound);
    c.lease_commence_date[i] = Number(r.lease_commence_date);
    c.postal[i] = Number(r.postal);
    c.floor_area_sqft[i] = Number(r.floor_area_sqft);
    c.resale_price[i] = Number(r.resale_price);
    c.remaining_lease_years[i] = Number(r.remaining_lease_years);
    c.psf[i] = f64(r.psf);
    c.latitude[i] = f64(r.latitude);
    c.longitude[i] = f64(r.longitude);
  }
  return c;
}

// ============================ query result shapes ============================

export interface RecentRow {
  month: string;
  town: string;
  address: string;
  flat_type: string;
  floor_area_sqft: number;
  resale_price: number;
  psf: number;
}
export interface ScatterRow {
  month: string;
  psf: number;
  address: string;
  storey: string;
  price: number;
  lease: number;
}
export interface Monthly {
  month: string;
  med: number;
  n: number;
}
export interface TownMapRow {
  lat: number;
  lng: number;
  price: number;
  address: string;
  month: string;
  storey: string;
  psf: number;
  lease: number;
}
export interface TownRecord {
  town: string;
  price: number;
  address: string;
  storey: string;
  area: number;
  month: string;
  med: number;
  flat: string;
  psf: number;
}

/** psf-trends slice — a serializable spec (no closures) so it can cross the worker boundary.
 * The zoom resample just sets monthTo; new filter dimensions would be additive fields. */
export interface PsfSpec {
  town: string;
  street: string; // '__all' or a street name
  storeyLo: number | null; // null → no storey band filter
  storeyHi: number | null;
  monthFrom: string; // START, or the zoom window lower bound
  monthTo?: string; // zoom window upper bound
  cap: number; // scatter sample cap (SCATTER_CAP)
}

// --- my-flat-insights result shapes ---
/** A comparable sale (one town+flat, rolling window) — bounded, so it may cross the boundary. */
export interface CompRow {
  month: string;
  address: string;
  street_name: string;
  storey_range: string;
  slo: number; // storey_lower_bound
  area: number; // floor_area_sqft
  lease: number; // remaining_lease_years
  price: number; // resale_price
  psf: number;
  lat: number | null;
  lng: number | null;
}
/** Postal → block identity (latest-transaction fields) + the flat types seen at that block. */
export interface BlockMeta {
  town: string;
  street: string;
  address: string;
  model: string;
  lc: number; // lease_commence_date
  lat: number | null;
  lng: number | null;
  flats: { flat_type: string; n: number }[];
}
export interface StoreysArea {
  storeys: { storey_range: string; lo: number }[];
  areaMedian: number;
}
export interface LeaseBucket {
  bucket: number;
  psf: number;
  n: number;
}
/** Everything my-flat-insights' compute() needs from the dataset, in one round-trip. The
 * page keeps the pure shaping (storey adjustment, histogram, benchmarks, returns, map). */
export interface ValuationData {
  comps: CompRow[];
  months: 12 | 24;
  island: { psf: number; price: number; area: number };
  trajectory: { yr: string; psf: number; price: number; n: number }[];
  leaseTown: LeaseBucket[];
  leaseIsland: LeaseBucket[];
}

// ============================ pure query functions ============================
// Each scans the columns to build an index list, aggregates over indices, and reads columns
// to build the small result. `now` is injectable for deterministic rolling-window tests.

/** Non-NaN psf values at the given row indices (excludes null-psf rows, like the old
 * `r.psf != null` filter before a median). */
const psfAt = (c: Columns, idx: number[]): number[] => {
  const out: number[] = [];
  for (const i of idx) if (!Number.isNaN(c.psf[i])) out.push(c.psf[i]);
  return out;
};
const gather = (col: Float64Array, idx: number[]): number[] => idx.map((i) => col[i]);

/** Landing page recent-transactions: 12-month window, optional town/flat, ORDER BY month
 * DESC, resale_price DESC, one page. Only the page (~20 rows) is returned. */
export function recentQuery(
  c: Columns,
  { town, flat, page, pageSize }: { town: string; flat: string; page: number; pageSize: number },
  now?: Date,
): { rows: RecentRow[]; total: number } {
  const cutoff = monthsAgo(12, now);
  const idx: number[] = [];
  for (let i = 0; i < c.n; i++) {
    if (
      c.month[i] >= cutoff &&
      (town === '__all' || c.town[i] === town) &&
      (flat === '__all' || c.flat_type[i] === flat)
    )
      idx.push(i);
  }
  idx.sort((a, b) =>
    c.month[a] < c.month[b]
      ? 1
      : c.month[a] > c.month[b]
        ? -1
        : c.resale_price[b] - c.resale_price[a],
  );
  const start = page * pageSize;
  const rows = idx.slice(start, start + pageSize).map((i) => ({
    month: c.month[i],
    town: c.town[i],
    address: c.address[i],
    flat_type: c.flat_type[i],
    floor_area_sqft: c.floor_area_sqft[i],
    resale_price: c.resale_price[i],
    psf: Number.isNaN(c.psf[i]) ? 0 : c.psf[i],
  }));
  return { rows, total: idx.length };
}

/** Distinct street names in a town, ascending. */
export function streetsQuery(c: Columns, town: string): string[] {
  const set = new Set<string>();
  for (let i = 0; i < c.n; i++) if (c.town[i] === town) set.add(c.street_name[i]);
  return [...set].sort();
}

/** psf-trends: filtered scatter (capped random sample) + per-month medians + total count. */
export function psfScatterQuery(
  c: Columns,
  spec: PsfSpec,
): { sample: ScatterRow[]; monthly: Monthly[]; total: number } {
  const idx: number[] = [];
  for (let i = 0; i < c.n; i++) {
    if (
      c.town[i] === spec.town &&
      c.month[i] >= spec.monthFrom &&
      (spec.monthTo === undefined || c.month[i] <= spec.monthTo) &&
      !Number.isNaN(c.psf[i]) &&
      (spec.street === '__all' || c.street_name[i] === spec.street) &&
      (spec.storeyLo === null ||
        (c.storey_lower_bound[i] >= spec.storeyLo &&
          c.storey_lower_bound[i] <= (spec.storeyHi ?? spec.storeyLo)))
    )
      idx.push(i);
  }
  const sample: ScatterRow[] = sampleN(idx, spec.cap).map((i) => ({
    month: c.month[i],
    psf: c.psf[i],
    address: c.address[i],
    storey: c.storey_range[i],
    price: c.resale_price[i],
    lease: c.remaining_lease_years[i],
  }));
  const monthly: Monthly[] = [...groupBy(idx, (i) => c.month[i]).entries()]
    .map(([month, is]) => ({ month, med: median(gather(c.psf, is)), n: is.length }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  return { sample, monthly, total: idx.length };
}

/** town-analysis map rows: town + flat (+ optional street), 24-month window, lat present,
 * ORDER BY month DESC, resale_price DESC. Bounded (one town+flat), so the rows can cross. */
export function townMapQuery(
  c: Columns,
  { town, flat, street }: { town: string; flat: string; street: string },
  now?: Date,
): TownMapRow[] {
  const cutoff = monthsAgo(24, now);
  const idx: number[] = [];
  for (let i = 0; i < c.n; i++) {
    if (
      c.town[i] === town &&
      c.flat_type[i] === flat &&
      (street === '__all' || c.street_name[i] === street) &&
      c.month[i] >= cutoff &&
      !Number.isNaN(c.latitude[i])
    )
      idx.push(i);
  }
  idx.sort((a, b) =>
    c.month[a] < c.month[b]
      ? 1
      : c.month[a] > c.month[b]
        ? -1
        : c.resale_price[b] - c.resale_price[a],
  );
  return idx.map((i) => ({
    lat: c.latitude[i],
    lng: c.longitude[i],
    price: c.resale_price[i],
    address: c.address[i],
    month: c.month[i],
    storey: c.storey_range[i],
    psf: Number.isNaN(c.psf[i]) ? 0 : c.psf[i],
    lease: c.remaining_lease_years[i],
  }));
}

/** town-analysis records: town mode (all sales in town) or global mode (peak sale per town),
 * each joined to the median resale_price of its own (town, flat_type). One page returned. */
export function townRecordsQuery(
  c: Columns,
  {
    town,
    scope,
    page,
    pageSize,
  }: { town: string; scope: 'town' | 'global'; page: number; pageSize: number },
): { rows: TownRecord[]; total: number } {
  const toRec = (i: number, med: number): TownRecord => ({
    town: c.town[i],
    price: c.resale_price[i],
    address: c.address[i],
    storey: c.storey_range[i],
    area: c.floor_area_sqft[i],
    month: c.month[i],
    med,
    flat: c.flat_type[i],
    psf: Number.isNaN(c.psf[i]) ? 0 : c.psf[i],
  });

  let ranked: number[];
  let total: number;
  let medFor: (i: number) => number;

  if (scope === 'town') {
    const townIdx: number[] = [];
    for (let i = 0; i < c.n; i++) if (c.town[i] === town) townIdx.push(i);
    const medMap = new Map<string, number>();
    for (const [flat, is] of groupBy(townIdx, (i) => c.flat_type[i]))
      medMap.set(flat, median(gather(c.resale_price, is)));
    ranked = [...townIdx].sort((a, b) => c.resale_price[b] - c.resale_price[a]);
    total = townIdx.length;
    medFor = (i) => medMap.get(c.flat_type[i]) ?? 0;
  } else {
    // Peak sale per town (max price, tie-break month DESC), then rank those across towns.
    const all: number[] = [];
    for (let i = 0; i < c.n; i++) all.push(i);
    const medMap = new Map<string, number>();
    for (const [k, is] of groupBy(all, (i) => `${c.town[i]}|${c.flat_type[i]}`))
      medMap.set(k, median(gather(c.resale_price, is)));
    const peak = new Map<string, number>();
    for (let i = 0; i < c.n; i++) {
      const cur = peak.get(c.town[i]);
      if (
        cur === undefined ||
        c.resale_price[i] > c.resale_price[cur] ||
        (c.resale_price[i] === c.resale_price[cur] && c.month[i] > c.month[cur])
      )
        peak.set(c.town[i], i);
    }
    ranked = [...peak.values()].sort((a, b) => c.resale_price[b] - c.resale_price[a]);
    total = peak.size;
    medFor = (i) => medMap.get(`${c.town[i]}|${c.flat_type[i]}`) ?? 0;
  }

  const start = page * pageSize;
  return { rows: ranked.slice(start, start + pageSize).map((i) => toRec(i, medFor(i))), total };
}

/** my-flat-insights postal lookup: block identity via arg_max(latest) + mode, plus the flat
 * types seen at that postal (count DESC). Returns null when the postal has no transactions. */
export function resolveBlockQuery(c: Columns, postal: number): BlockMeta | null {
  const idx: number[] = [];
  for (let i = 0; i < c.n; i++) if (c.postal[i] === postal) idx.push(i);
  if (!idx.length) return null;
  const latest = <V>(pick: (i: number) => V): V | undefined => argMax(idx, (i) => c.month[i], pick);
  const lat = latest((i) => c.latitude[i]);
  const lng = latest((i) => c.longitude[i]);
  return {
    town: latest((i) => c.town[i]) ?? '',
    street: latest((i) => c.street_name[i]) ?? '',
    address: latest((i) => c.address[i]) ?? '',
    model: mode(idx, (i) => c.flat_model[i]) ?? '',
    lc: Number(mode(idx, (i) => c.lease_commence_date[i]) ?? 0),
    lat: lat == null || Number.isNaN(lat) ? null : lat,
    lng: lng == null || Number.isNaN(lng) ? null : lng,
    flats: [...groupBy(idx, (i) => c.flat_type[i])]
      .map(([flat_type, is]) => ({ flat_type, n: is.length }))
      .sort((a, b) => b.n - a.n),
  };
}

/** Dependent fields for a postal+flat: storey ranges (min lower-bound, ASC) + median area. */
export function storeysAreaQuery(c: Columns, postal: number, flat: string): StoreysArea {
  const idx: number[] = [];
  for (let i = 0; i < c.n; i++) if (c.postal[i] === postal && c.flat_type[i] === flat) idx.push(i);
  return {
    storeys: [...groupBy(idx, (i) => c.storey_range[i])]
      .map(([storey_range, is]) => ({
        storey_range,
        lo: Math.min(...is.map((i) => c.storey_lower_bound[i])),
      }))
      .sort((a, b) => a.lo - b.lo),
    areaMedian: median(gather(c.floor_area_sqft, idx)),
  };
}

/** The full valuation dataset: comps (12mo, widened to 24 if thin), island medians, yearly
 * trajectory, and lease-decay buckets (town: 36mo/n>=8, island: 24mo/n>=30). */
export function valuationQuery(
  c: Columns,
  { town, flat }: { town: string; flat: string },
  now?: Date,
): ValuationData {
  const c12 = monthsAgo(12, now);
  const c24 = monthsAgo(24, now);
  const c36 = monthsAgo(36, now);

  const inTownFlat: number[] = [];
  for (let i = 0; i < c.n; i++)
    if (c.town[i] === town && c.flat_type[i] === flat) inTownFlat.push(i);

  let months: 12 | 24 = 12;
  let comps = inTownFlat.filter((i) => c.month[i] >= c12);
  if (comps.length < 10) {
    months = 24;
    comps = inTownFlat.filter((i) => c.month[i] >= c24);
  }
  const compRows: CompRow[] = comps.map((i) => ({
    month: c.month[i],
    address: c.address[i],
    street_name: c.street_name[i],
    storey_range: c.storey_range[i],
    slo: c.storey_lower_bound[i],
    area: c.floor_area_sqft[i],
    lease: c.remaining_lease_years[i],
    price: c.resale_price[i],
    psf: Number.isNaN(c.psf[i]) ? 0 : c.psf[i],
    lat: Number.isNaN(c.latitude[i]) ? null : c.latitude[i],
    lng: Number.isNaN(c.longitude[i]) ? null : c.longitude[i],
  }));

  const islandIdx: number[] = [];
  for (let i = 0; i < c.n; i++) if (c.flat_type[i] === flat && c.month[i] >= c12) islandIdx.push(i);
  const island = {
    psf: median(psfAt(c, islandIdx)),
    price: median(gather(c.resale_price, islandIdx)),
    area: median(gather(c.floor_area_sqft, islandIdx)),
  };

  const trajectory = [...groupBy(inTownFlat, (i) => yearOf(c.month[i]))]
    .map(([yr, is]) => ({
      yr,
      psf: median(psfAt(c, is)),
      price: median(gather(c.resale_price, is)),
      n: is.length,
    }))
    .sort((a, b) => (a.yr < b.yr ? -1 : 1));

  const buckets = (src: number[], cutoff: string, minN: number): LeaseBucket[] =>
    [
      ...groupBy(
        src.filter((i) => c.month[i] >= cutoff),
        (i) => Math.floor(c.remaining_lease_years[i] / 10) * 10,
      ),
    ]
      .map(([bucket, is]) => ({ bucket, psf: median(psfAt(c, is)), n: is.length }))
      .filter((g) => g.n >= minN)
      .sort((a, b) => a.bucket - b.bucket);

  const islandAll: number[] = [];
  for (let i = 0; i < c.n; i++) if (c.flat_type[i] === flat) islandAll.push(i);

  return {
    comps: compRows,
    months,
    island,
    trajectory,
    leaseTown: buckets(inTownFlat, c36, 8),
    leaseIsland: buckets(islandAll, c24, 30),
  };
}

// ============================ resident engine ============================

// ---- cross-session cache (IndexedDB) ----
// Persist the decoded columns keyed by the data's lastUpdatedEpoch (+ a schema tag). A repeat
// visit after the worker is gone restores the typed arrays and skips the parquet fetch +
// decode entirely; a new ETL run (new epoch) or a Columns-shape change (new tag) misses and
// re-decodes. Best-effort: any IDB error falls back to decoding. IndexedDB is available in
// both window and worker scopes; structured clone stores the typed arrays as-is.
const IDB_DB = 'hyparquet';
const IDB_STORE = 'columns';
const IDB_TAG = 'v1'; // bump if the Columns shape changes

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Columns | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  const db = await idbOpen();
  try {
    return await new Promise<Columns | undefined>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as Columns | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, cols: Columns): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await idbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.clear(); // keep only the current epoch/tag
      store.put(cols, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

let columnsPromise: Promise<Columns> | null = null;

/** Lazily produce the columnar dataset, cached for the session. Tries the IndexedDB cache
 * first (keyed by lastUpdatedEpoch); on a miss, fetches resale.parquet, decodes via
 * parquetReadObjects, transposes to columns (row objects dropped), and writes the cache in
 * the background. A failed load isn't cached in-memory (next call retries). */
export function loadColumns(): Promise<Columns> {
  return (columnsPromise ??= (async () => {
    const manifest = await readManifest();
    const key =
      manifest.lastUpdatedEpoch != null ? `${IDB_TAG}:${manifest.lastUpdatedEpoch}` : null;
    if (key) {
      const cached = await idbGet(key).catch(() => undefined);
      if (cached) return cached;
    }
    const file = await fetchDataFile(manifest.file);
    const rows = await parquetReadObjects({ file, compressors });
    const cols = toColumns(rows as unknown as ResaleRow[]);
    if (key) void idbPut(key, cols).catch(() => {});
    return cols;
  })().catch((e) => {
    columnsPromise = null;
    throw e;
  }));
}

/** The set of methods exposed across the Comlink boundary. All async, all return small,
 * structured-cloneable summaries. */
export interface HyparquetApi {
  warm(): Promise<void>;
  recent(o: {
    town: string;
    flat: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: RecentRow[]; total: number }>;
  streets(town: string): Promise<string[]>;
  psfScatter(spec: PsfSpec): Promise<{ sample: ScatterRow[]; monthly: Monthly[]; total: number }>;
  townMap(o: { town: string; flat: string; street: string }): Promise<TownMapRow[]>;
  townRecords(o: {
    town: string;
    scope: 'town' | 'global';
    page: number;
    pageSize: number;
  }): Promise<{ rows: TownRecord[]; total: number }>;
  resolveBlock(postal: number): Promise<BlockMeta | null>;
  storeysAndArea(postal: number, flat: string): Promise<StoreysArea>;
  valuation(o: { town: string; flat: string }): Promise<ValuationData>;
}

/** The resident engine: owns the decoded columns (via loadColumns) and runs every scan.
 * Instantiated inside the Web Worker; the columns never leave this context. */
export function createEngine(): HyparquetApi {
  return {
    async warm() {
      await loadColumns();
    },
    async recent(o) {
      return recentQuery(await loadColumns(), o);
    },
    async streets(town) {
      return streetsQuery(await loadColumns(), town);
    },
    async psfScatter(spec) {
      return psfScatterQuery(await loadColumns(), spec);
    },
    async townMap(o) {
      return townMapQuery(await loadColumns(), o);
    },
    async townRecords(o) {
      return townRecordsQuery(await loadColumns(), o);
    },
    async resolveBlock(postal) {
      return resolveBlockQuery(await loadColumns(), postal);
    },
    async storeysAndArea(postal, flat) {
      return storeysAreaQuery(await loadColumns(), postal, flat);
    },
    async valuation(o) {
      return valuationQuery(await loadColumns(), o);
    },
  };
}
