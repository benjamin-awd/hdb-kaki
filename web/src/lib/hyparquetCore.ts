// Pure hyparquet data engine — NO DOM, NO Comlink, NO Worker imports. It runs inside the
// browser Web Worker (hyparquetWorker.ts) that owns the decoded rows, and doubles as the
// main-thread fallback when module workers are unavailable. Every query function is pure
// (rows + params [+ now] → a small, structured-cloneable summary) so it is directly
// unit-testable and so only summaries — never the ~236k-row array — cross the Comlink
// boundary.
//
// resale.parquet is ZSTD-compressed (webapp/update/emit_web.py); hyparquet doesn't decode
// ZSTD natively, so we pass the decompressor from hyparquet-compressors (pure JS).
import { parquetReadObjects, type AsyncBuffer } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

interface Manifest {
  file: string;
}

// One request for the whole (small) file, decoded to row objects. Uses bare `location`
// (present in both window and worker scopes — a Worker has no `window`). Vite still inlines
// import.meta.env.BASE_URL in worker chunks.
async function fetchParquet(): Promise<Record<string, unknown>[]> {
  const base = import.meta.env.BASE_URL;
  const manifest: Manifest = await fetch(`${base}data/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest.json ${r.status}`);
    return r.json();
  });
  const url = new URL(`${base}data/${manifest.file}`, location.href).href;
  const abuf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${manifest.file} ${r.status}`);
    return r.arrayBuffer();
  });
  const file: AsyncBuffer = { byteLength: abuf.byteLength, slice: (s, e) => abuf.slice(s, e) };
  return parquetReadObjects({ file, compressors });
}

// ============================ JS aggregation toolkit ============================
// Pure aggregation helpers. Parity target is polars (webapp/update/emit_web.py), which
// the default snapshots are emitted from.

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

/** Bucket rows by a key, preserving first-seen key order. */
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

/** arg_max(pick, by): the `pick` value of the row with the greatest `by`. */
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

/** A random subset of size n (all rows if fewer than n). */
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

// ============================== row types ==============================

/** A resale transaction row with every column the pages read, numerics coerced. */
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

/** Coerce a raw hyparquet row IN PLACE into a ResaleRow. int64 columns decode as BigInt, so
 * cast the numeric fields to plain numbers (keeping nulls); string columns already arrive as
 * strings. Mutating the objects hyparquet already built avoids a second full materialization
 * pass, and keeps only plain numbers/strings crossing the Comlink boundary. */
function coerceRowInPlace(r: Record<string, unknown>): void {
  r.storey_lower_bound = Number(r.storey_lower_bound);
  r.floor_area_sqft = Number(r.floor_area_sqft);
  r.resale_price = Number(r.resale_price);
  r.remaining_lease_years = Number(r.remaining_lease_years);
  r.lease_commence_date = Number(r.lease_commence_date);
  r.postal = Number(r.postal);
  r.psf = r.psf == null ? null : Number(r.psf);
  r.latitude = r.latitude == null ? null : Number(r.latitude);
  r.longitude = r.longitude == null ? null : Number(r.longitude);
  if (r.flat_model == null) r.flat_model = '';
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
// Each takes the resident rows + params and returns a small summary. `now` is injectable
// for deterministic tests of the rolling-window queries.

/** Landing page recent-transactions: 12-month window, optional town/flat, ORDER BY month
 * DESC, resale_price DESC, one page. Only the page (~20 rows) is returned. */
export function recentQuery(
  rows: readonly ResaleRow[],
  { town, flat, page, pageSize }: { town: string; flat: string; page: number; pageSize: number },
  now?: Date,
): { rows: RecentRow[]; total: number } {
  const cutoff = monthsAgo(12, now);
  const filtered = rows.filter(
    (r) =>
      r.month >= cutoff &&
      (town === '__all' || r.town === town) &&
      (flat === '__all' || r.flat_type === flat),
  );
  filtered.sort((a, b) =>
    a.month < b.month ? 1 : a.month > b.month ? -1 : b.resale_price - a.resale_price,
  );
  const start = page * pageSize;
  const pageRows = filtered.slice(start, start + pageSize).map((r) => ({
    month: r.month,
    town: r.town,
    address: r.address,
    flat_type: r.flat_type,
    floor_area_sqft: r.floor_area_sqft,
    resale_price: r.resale_price,
    psf: r.psf ?? 0,
  }));
  return { rows: pageRows, total: filtered.length };
}

/** Distinct street names in a town, ascending. */
export function streetsQuery(rows: readonly ResaleRow[], town: string): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.town === town) set.add(r.street_name);
  return [...set].sort();
}

/** psf-trends: filtered scatter (capped random sample) + per-month medians + total count. */
export function psfScatterQuery(
  rows: readonly ResaleRow[],
  spec: PsfSpec,
): { sample: ScatterRow[]; monthly: Monthly[]; total: number } {
  const filtered = rows.filter(
    (r) =>
      r.town === spec.town &&
      r.month >= spec.monthFrom &&
      (spec.monthTo === undefined || r.month <= spec.monthTo) &&
      r.psf != null &&
      (spec.street === '__all' || r.street_name === spec.street) &&
      (spec.storeyLo === null ||
        (r.storey_lower_bound >= spec.storeyLo &&
          r.storey_lower_bound <= (spec.storeyHi ?? spec.storeyLo))),
  );
  const sample: ScatterRow[] = sampleN(filtered, spec.cap).map((r) => ({
    month: r.month,
    psf: r.psf as number,
    address: r.address,
    storey: r.storey_range,
    price: r.resale_price,
    lease: r.remaining_lease_years,
  }));
  const monthly: Monthly[] = [...groupBy(filtered, (r) => r.month).entries()]
    .map(([month, rs]) => ({ month, med: median(rs.map((r) => r.psf as number)), n: rs.length }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  return { sample, monthly, total: filtered.length };
}

/** town-analysis map rows: town + flat (+ optional street), 24-month window, lat present,
 * ORDER BY month DESC, resale_price DESC. Bounded (one town+flat), so the rows can cross. */
export function townMapQuery(
  rows: readonly ResaleRow[],
  { town, flat, street }: { town: string; flat: string; street: string },
  now?: Date,
): TownMapRow[] {
  const cutoff = monthsAgo(24, now);
  return rows
    .filter(
      (r) =>
        r.town === town &&
        r.flat_type === flat &&
        (street === '__all' || r.street_name === street) &&
        r.month >= cutoff &&
        r.latitude != null,
    )
    .sort((a, b) =>
      a.month < b.month ? 1 : a.month > b.month ? -1 : b.resale_price - a.resale_price,
    )
    .map((r) => ({
      lat: r.latitude as number,
      lng: r.longitude as number,
      price: r.resale_price,
      address: r.address,
      month: r.month,
      storey: r.storey_range,
      psf: r.psf ?? 0,
      lease: r.remaining_lease_years,
    }));
}

/** town-analysis records: town mode (all sales in town) or global mode (peak sale per town),
 * each joined to the median resale_price of its own (town, flat_type). One page returned. */
export function townRecordsQuery(
  rows: readonly ResaleRow[],
  {
    town,
    scope,
    page,
    pageSize,
  }: { town: string; scope: 'town' | 'global'; page: number; pageSize: number },
): { rows: TownRecord[]; total: number } {
  const toRec = (r: ResaleRow, med: number): TownRecord => ({
    town: r.town,
    price: r.resale_price,
    address: r.address,
    storey: r.storey_range,
    area: r.floor_area_sqft,
    month: r.month,
    med,
    flat: r.flat_type,
    psf: r.psf ?? 0,
  });

  let ranked: ResaleRow[];
  let total: number;
  let medFor: (r: ResaleRow) => number;

  if (scope === 'town') {
    const townRows = rows.filter((r) => r.town === town);
    const medMap = new Map<string, number>();
    for (const [flat, rs] of groupBy(townRows, (r) => r.flat_type))
      medMap.set(flat, median(rs.map((r) => r.resale_price)));
    ranked = [...townRows].sort((a, b) => b.resale_price - a.resale_price);
    total = townRows.length;
    medFor = (r) => medMap.get(r.flat_type) ?? 0;
  } else {
    // Peak sale per town (max price, tie-break month DESC), then rank those across towns.
    const medMap = new Map<string, number>();
    for (const [k, rs] of groupBy(rows, (r) => `${r.town}|${r.flat_type}`))
      medMap.set(k, median(rs.map((r) => r.resale_price)));
    const peak = new Map<string, ResaleRow>();
    for (const r of rows) {
      const cur = peak.get(r.town);
      if (
        !cur ||
        r.resale_price > cur.resale_price ||
        (r.resale_price === cur.resale_price && r.month > cur.month)
      )
        peak.set(r.town, r);
    }
    ranked = [...peak.values()].sort((a, b) => b.resale_price - a.resale_price);
    total = peak.size;
    medFor = (r) => medMap.get(`${r.town}|${r.flat_type}`) ?? 0;
  }

  const start = page * pageSize;
  return { rows: ranked.slice(start, start + pageSize).map((r) => toRec(r, medFor(r))), total };
}

const psfNonNull = (rows: readonly ResaleRow[]): number[] =>
  rows.filter((r) => r.psf != null).map((r) => r.psf as number);

/** my-flat-insights postal lookup: block identity via arg_max(latest) + mode, plus the flat
 * types seen at that postal (count DESC). Returns null when the postal has no transactions. */
export function resolveBlockQuery(rows: readonly ResaleRow[], postal: number): BlockMeta | null {
  const pr = rows.filter((r) => r.postal === postal);
  if (!pr.length) return null;
  return {
    town:
      argMax(
        pr,
        (r) => r.month,
        (r) => r.town,
      ) ?? '',
    street:
      argMax(
        pr,
        (r) => r.month,
        (r) => r.street_name,
      ) ?? '',
    address:
      argMax(
        pr,
        (r) => r.month,
        (r) => r.address,
      ) ?? '',
    model: mode(pr, (r) => r.flat_model) ?? '',
    lc: Number(mode(pr, (r) => r.lease_commence_date) ?? 0),
    lat:
      argMax(
        pr,
        (r) => r.month,
        (r) => r.latitude,
      ) ?? null,
    lng:
      argMax(
        pr,
        (r) => r.month,
        (r) => r.longitude,
      ) ?? null,
    flats: [...groupBy(pr, (r) => r.flat_type)]
      .map(([flat_type, rs]) => ({ flat_type, n: rs.length }))
      .sort((a, b) => b.n - a.n),
  };
}

/** Dependent fields for a postal+flat: storey ranges (min lower-bound, ASC) + median area. */
export function storeysAreaQuery(
  rows: readonly ResaleRow[],
  postal: number,
  flat: string,
): StoreysArea {
  const pr = rows.filter((r) => r.postal === postal && r.flat_type === flat);
  return {
    storeys: [...groupBy(pr, (r) => r.storey_range)]
      .map(([storey_range, rs]) => ({
        storey_range,
        lo: Math.min(...rs.map((r) => r.storey_lower_bound)),
      }))
      .sort((a, b) => a.lo - b.lo),
    areaMedian: median(pr.map((r) => r.floor_area_sqft)),
  };
}

/** The full valuation dataset: comps (12mo, widened to 24 if thin), island medians, yearly
 * trajectory, and lease-decay buckets (town: 36mo/n>=8, island: 24mo/n>=30). */
export function valuationQuery(
  rows: readonly ResaleRow[],
  { town, flat }: { town: string; flat: string },
  now?: Date,
): ValuationData {
  const c12 = monthsAgo(12, now);
  const c24 = monthsAgo(24, now);
  const c36 = monthsAgo(36, now);
  const inTownFlat = rows.filter((r) => r.town === town && r.flat_type === flat);

  let months: 12 | 24 = 12;
  let comps = inTownFlat.filter((r) => r.month >= c12);
  if (comps.length < 10) {
    months = 24;
    comps = inTownFlat.filter((r) => r.month >= c24);
  }
  const compRows: CompRow[] = comps.map((r) => ({
    month: r.month,
    address: r.address,
    street_name: r.street_name,
    storey_range: r.storey_range,
    slo: r.storey_lower_bound,
    area: r.floor_area_sqft,
    lease: r.remaining_lease_years,
    price: r.resale_price,
    psf: r.psf ?? 0,
    lat: r.latitude,
    lng: r.longitude,
  }));

  const islandRows = rows.filter((r) => r.flat_type === flat && r.month >= c12);
  const island = {
    psf: median(psfNonNull(islandRows)),
    price: median(islandRows.map((r) => r.resale_price)),
    area: median(islandRows.map((r) => r.floor_area_sqft)),
  };

  const trajectory = [...groupBy(inTownFlat, (r) => yearOf(r.month))]
    .map(([yr, rs]) => ({
      yr,
      psf: median(psfNonNull(rs)),
      price: median(rs.map((r) => r.resale_price)),
      n: rs.length,
    }))
    .sort((a, b) => (a.yr < b.yr ? -1 : 1));

  const buckets = (src: ResaleRow[], cutoff: string, minN: number): LeaseBucket[] =>
    [
      ...groupBy(
        src.filter((r) => r.month >= cutoff),
        (r) => Math.floor(r.remaining_lease_years / 10) * 10,
      ),
    ]
      .map(([bucket, rs]) => ({ bucket, psf: median(psfNonNull(rs)), n: rs.length }))
      .filter((g) => g.n >= minN)
      .sort((a, b) => a.bucket - b.bucket);

  return {
    comps: compRows,
    months,
    island,
    trajectory,
    leaseTown: buckets(inTownFlat, c36, 8),
    leaseIsland: buckets(
      rows.filter((r) => r.flat_type === flat),
      c24,
      30,
    ),
  };
}

// ============================ resident engine ============================

let allRowsPromise: Promise<ResaleRow[]> | null = null;

/** Lazily fetch + decode all of resale.parquet into memory, cached. A failed load isn't
 * cached (next call retries), mirroring db.ts. Used by createEngine and by the main-thread
 * pages that still aggregate locally (my-flat-insights, until Phase 2). */
export function loadResaleRows(): Promise<ResaleRow[]> {
  return (allRowsPromise ??= (async () => {
    const rows = await fetchParquet();
    for (let i = 0; i < rows.length; i++) coerceRowInPlace(rows[i]);
    return rows as unknown as ResaleRow[];
  })().catch((e) => {
    allRowsPromise = null;
    throw e;
  }));
}

/** Boot the in-memory table now (at idle), so the first query resolves instantly. */
export function prefetchResale(): void {
  loadResaleRows().catch(() => {});
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

/** The resident engine: owns the decoded rows (via loadResaleRows) and runs every scan.
 * Instantiated inside the Web Worker; the row array never leaves this context. */
export function createEngine(): HyparquetApi {
  return {
    async warm() {
      await loadResaleRows();
    },
    async recent(o) {
      return recentQuery(await loadResaleRows(), o);
    },
    async streets(town) {
      return streetsQuery(await loadResaleRows(), town);
    },
    async psfScatter(spec) {
      return psfScatterQuery(await loadResaleRows(), spec);
    },
    async townMap(o) {
      return townMapQuery(await loadResaleRows(), o);
    },
    async townRecords(o) {
      return townRecordsQuery(await loadResaleRows(), o);
    },
    async resolveBlock(postal) {
      return resolveBlockQuery(await loadResaleRows(), postal);
    },
    async storeysAndArea(postal, flat) {
      return storeysAreaQuery(await loadResaleRows(), postal, flat);
    },
    async valuation(o) {
      return valuationQuery(await loadResaleRows(), o);
    },
  };
}
