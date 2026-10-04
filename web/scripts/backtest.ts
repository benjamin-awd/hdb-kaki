// Backtest the Flat Insights valuation (valuationQuery + lib/valuation.ts, the code the page
// runs) against real resales. Each held-out sale is valued with only the data before its sale
// month, the way the page would have valued it then, and scored against what it sold for.
// Also measures the 1 January "lease tick": how far estimates move when every block's
// remaining lease drops a year with no new sales.
//
//   bun run backtest                       # needs public/data/resale.parquet (generated)
//   N=1000 bun run backtest                # smaller random sample
//   bun run backtest -- --rows out.json    # also dump per-sale rows
import { readFileSync, writeFileSync } from 'node:fs';
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import {
  toColumns,
  valuationQuery,
  resolveBlockQuery,
  storeysAreaQuery,
  type Columns,
  type ResaleRow,
} from '../src/lib/hyparquetCore';
import { valuate, med } from '../src/lib/valuation';

const HOLD_MONTHS = 9; // complete months before the latest (partial) one
const N = Number(process.env.N ?? 3000);
const MIN_PER_CELL = 12; // stratified top-up so every town × flat type is represented
const CLIFF_BLOCKS = 600;

const args = process.argv.slice(2);
const rowsOut = args.includes('--rows') ? args[args.indexOf('--rows') + 1] : null;

// Seeded PRNG (mulberry32) so runs are comparable across commits.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function load(): Promise<Columns> {
  const b = readFileSync(new URL('../public/data/resale.parquet', import.meta.url));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const file = { byteLength: ab.byteLength, slice: (s: number, e?: number) => ab.slice(s, e) };
  return toColumns((await parquetReadObjects({ file, compressors })) as unknown as ResaleRow[]);
}

/** A copy of the columns keeping only rows where `keep(i)`. */
function filterCols(c: Columns, keep: (i: number) => boolean): Columns {
  const idx: number[] = [];
  for (let i = 0; i < c.n; i++) if (keep(i)) idx.push(i);
  const out: Record<string, unknown> = { n: idx.length };
  for (const [k, v] of Object.entries(c)) {
    if (k === 'n') continue;
    if (Array.isArray(v)) out[k] = idx.map((i) => v[i]);
    else {
      const src = v as Float64Array | Int32Array;
      const a = new (src.constructor as Float64ArrayConstructor)(idx.length);
      idx.forEach((i, j) => (a[j] = src[i]));
      out[k] = a;
    }
  }
  return out as unknown as Columns;
}

const remainingLease = (lc: number, year: number) =>
  lc ? Math.max(1, Math.min(99, 99 - (year - lc))) : 0; // as the page derives it

const q = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const pct = (x: number, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '–');

interface Row {
  month: string;
  town: string;
  flat: string;
  postal: number;
  address: string;
  storey: string;
  slo: number;
  lease: number;
  area: number;
  price: number;
  scope: string;
  n: number;
  estimate: number;
  low: number;
  high: number;
  conf: string;
  width: number; // spread: IQR / median of the adjusted comps
  leaseSpan: number;
  slope: number; // $ psf per floor
  leaseCoef: number; // $ psf per lease year
}

const tier = (r: Row) => r.scope;
const leaseBucket = (r: Row) =>
  r.lease < 50 ? '<50' : r.lease < 70 ? '50-70' : r.lease < 90 ? '70-90' : '90+';
const storeyBucket = (r: Row) =>
  r.slo <= 3
    ? '01-03'
    : r.slo <= 9
      ? '04-09'
      : r.slo <= 18
        ? '10-18'
        : r.slo <= 30
          ? '19-30'
          : '31+';
const widthBucket = (r: Row) =>
  r.width < 0.05
    ? 'a <5%'
    : r.width < 0.08
      ? 'b 5-8%'
      : r.width < 0.12
        ? 'c 8-12%'
        : r.width < 0.2
          ? 'd 12-20%'
          : r.width < 0.3
            ? 'e 20-30%'
            : 'f 30%+';

function table(title: string, rows: Row[], key: (r: Row) => string, sortByKey = true) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) (groups.get(key(r)) ?? groups.set(key(r), []).get(key(r))!).push(r);
  const entries = [...groups].sort((a, b) =>
    sortByKey ? (a[0] < b[0] ? -1 : 1) : b[1].length - a[1].length,
  );
  const lines = [
    `\n### ${title}\n`,
    '| group | n | median APE | P90 APE | median signed | in range |',
    '|---|---|---|---|---|---|',
  ];
  for (const [k, rs] of entries) lines.push(line(k, rs));
  return lines.join('\n');
}
function line(k: string, rs: Row[]) {
  const scored = rs.filter((r) => r.estimate > 0);
  const ape = scored.map((r) => Math.abs(r.estimate / r.price - 1));
  const signed = scored.map((r) => r.estimate / r.price - 1);
  const inRange = scored.filter((r) => r.price >= r.low && r.price <= r.high).length;
  return `| ${k} | ${rs.length} | ${pct(med(ape))} | ${pct(q(ape, 0.9))} | ${pct(med(signed))} | ${pct(inRange / (scored.length || 1), 0)} |`;
}

const c = await load();
let latest = '';
for (let i = 0; i < c.n; i++) if (c.month[i] > latest) latest = c.month[i];
const months = new Set<string>();
for (let i = 0; i < c.n; i++) if (c.month[i] < latest) months.add(c.month[i]);
const hold = [...months].sort().slice(-HOLD_MONTHS);

// ---- sample: N random held-out sales + a top-up so every town × flat type has a few ----
const R = rng(42);
const pool: number[] = [];
for (let i = 0; i < c.n; i++) if (hold.includes(c.month[i])) pool.push(i);
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(R() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const random = new Set(pool.slice(0, N));
const chosen = new Set(random);
const cells = new Map<string, number[]>();
for (const i of pool) {
  const k = c.town[i] + '|' + c.flat_type[i];
  (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
}
for (const is of cells.values()) {
  let have = is.filter((i) => chosen.has(i)).length;
  for (const i of is) {
    if (have >= MIN_PER_CELL) break;
    if (!chosen.has(i)) {
      chosen.add(i);
      have++;
    }
  }
}

// ---- value each sale from the data before its month ----
const rows: Row[] = [];
const isRandom: boolean[] = [];
const byMonth = new Map<string, number[]>();
for (const i of chosen)
  (byMonth.get(c.month[i]) ?? byMonth.set(c.month[i], []).get(c.month[i])!).push(i);
for (const [M, is] of [...byMonth].sort()) {
  const prior = filterCols(c, (j) => c.month[j] < M);
  const now = new Date(`${M}-15T12:00:00`);
  const year = now.getFullYear();
  for (const i of is) {
    const lease = remainingLease(c.lease_commence_date[i], year);
    const lat = Number.isNaN(c.latitude[i]) ? null : c.latitude[i];
    const lng = Number.isNaN(c.longitude[i]) ? null : c.longitude[i];
    const q = valuationQuery(
      prior,
      { town: c.town[i], flat: c.flat_type[i], lease, lat, lng },
      now,
    );
    const v = valuate(q, { storey: c.storey_range[i], area: c.floor_area_sqft[i], lease });
    const leases = q.comps.map((x) => x.lease);
    rows.push({
      month: M,
      town: c.town[i],
      flat: c.flat_type[i],
      postal: c.postal[i],
      address: c.address[i],
      storey: c.storey_range[i],
      slo: c.storey_lower_bound[i],
      lease,
      area: c.floor_area_sqft[i],
      price: c.resale_price[i],
      scope: `${q.scope}${'radius' in q && q.radius ? ` ${q.radius} m` : ''} ${q.months}m`,
      n: v.n,
      estimate: v.estimate,
      low: v.low,
      high: v.high,
      conf: v.confLabel,
      width: v.spread,
      leaseSpan: leases.length ? Math.max(...leases) - Math.min(...leases) : 0,
      slope: v.slope,
      leaseCoef: 'leaseCoef' in v ? (v.leaseCoef as number) : 0,
    });
    isRandom.push(random.has(i));
  }
}
const rnd = rows.filter((_, k) => isRandom[k]);

// ---- 1 January lease tick: value random blocks at lease L and L-1 ----
const now = new Date(`${latest}-15T12:00:00`);
const postals = [...new Set(c.postal)];
const RC = rng(11);
const ticks: { d: number; flip: boolean; label: string }[] = [];
for (let k = 0; k < CLIFF_BLOCKS; k++) {
  const postal = postals[Math.floor(RC() * postals.length)];
  const m = resolveBlockQuery(c, postal)!;
  const flat = m.flats[0].flat_type;
  const { storeys, areaMedian } = storeysAreaQuery(c, postal, flat);
  const storey = storeys[Math.floor(storeys.length / 2)].storey_range;
  const L = remainingLease(m.lc, now.getFullYear());
  const at = (lease: number) => {
    const qv = valuationQuery(c, { town: m.town, flat, lease, lat: m.lat, lng: m.lng }, now);
    return { qv, v: valuate(qv, { storey, area: Math.round(areaMedian), lease }) };
  };
  const a = at(L),
    b = at(L - 1);
  ticks.push({
    d: b.v.estimate / a.v.estimate - 1,
    flip: a.qv.scope !== b.qv.scope || a.qv.months !== b.qv.months,
    label: `${postal} ${m.address} ${flat} lease ${L}→${L - 1}`,
  });
}
const absTick = ticks.map((t) => Math.abs(t.d)).filter(Number.isFinite);

// ---- report ----
const out = [
  `## Backtest: held-out ${hold[0]}..${hold[hold.length - 1]}, ${rnd.length} random sales (+${rows.length - rnd.length} stratified)`,
  '\n| group | n | median APE | P90 APE | median signed | in range |',
  '|---|---|---|---|---|---|',
  line('**all (random)**', rnd),
  line('all (incl. stratified)', rows),
  `\nPremiums (random sample, p10/p50/p90): storey ${[0.1, 0.5, 0.9]
    .map((p) =>
      q(
        rnd.map((r) => r.slope),
        p,
      ).toFixed(1),
    )
    .join('/')} psf/floor · lease ${[0.1, 0.5, 0.9]
    .map((p) =>
      q(
        rnd.map((r) => r.leaseCoef),
        p,
      ).toFixed(1),
    )
    .join('/')} psf/yr`,
  table('By scope (random sample)', rnd, tier),
  table('By confidence (random sample)', rnd, (r) => r.conf),
  table('By comp spread, IQR/median (random sample)', rnd, widthBucket),
  table('By lease at sale (random sample)', rnd, leaseBucket),
  table('By storey (random sample)', rnd, storeyBucket),
  table('By flat type (all rows)', rows, (r) => r.flat),
  `\n### 1 January lease tick (${absTick.length} blocks, lease L → L-1)\n`,
  `moves >3%: ${pct(absTick.filter((x) => x > 0.03).length / absTick.length)} · >5%: ${pct(absTick.filter((x) => x > 0.05).length / absTick.length)} · >10%: ${pct(absTick.filter((x) => x > 0.1).length / absTick.length)} · median |move| ${pct(med(absTick), 2)} · scope flips ${ticks.filter((t) => t.flip).length}`,
  ...ticks
    .filter((t) => Number.isFinite(t.d))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 5)
    .map((t) => `- ${t.label}: ${t.d >= 0 ? '+' : ''}${pct(t.d)}`),
];
console.log(out.join('\n'));
if (rowsOut) writeFileSync(rowsOut, JSON.stringify(rows));
