import { test, expect, describe } from 'bun:test';
import {
  median,
  quantileSorted,
  argMax,
  mode,
  sampleN,
  monthsAgo,
  yearOf,
  toColumns,
  recentQuery,
  streetsQuery,
  psfScatterQuery,
  townMapQuery,
  townRecordsQuery,
  resolveBlockQuery,
  storeysAreaQuery,
  valuationQuery,
  type ResaleRow,
} from './hyparquetCore';

// A fixed "now" so the rolling-window queries (12/24-month) are deterministic.
const NOW = new Date('2026-07-15T00:00:00Z');

function row(o: Partial<ResaleRow>): ResaleRow {
  return {
    month: '2026-01',
    _ts: '2026-01-15',
    town: 'BEDOK',
    address: 'BLK 1',
    street_name: 'BEDOK AVE 1',
    flat_type: '4 ROOM',
    flat_model: 'Model A',
    storey_range: '01 TO 03',
    storey_lower_bound: 1,
    floor_area_sqft: 1000,
    resale_price: 500000,
    psf: 500,
    remaining_lease_years: 70,
    lease_commence_date: 1985,
    latitude: 1.32,
    longitude: 103.9,
    postal: 460001,
    ...o,
  };
}

/** Build the columnar dataset the query fns take, from row fixtures. */
const cols = (rows: ResaleRow[]) => toColumns(rows);

describe('toolkit', () => {
  test('median: midpoint interpolation (polars parity)', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5); // even → avg of middle two
    expect(median([])).toBe(0);
  });

  test('quantileSorted: linear interpolation', () => {
    const a = [10, 20, 30, 40];
    expect(quantileSorted(a, 0.25)).toBe(17.5);
    expect(quantileSorted(a, 0.75)).toBe(32.5);
    expect(quantileSorted(a, 0.5)).toBe(median(a));
  });

  test('argMax: pick value at the greatest by', () => {
    const rs = [
      row({ month: '2025-01', town: 'A' }),
      row({ month: '2025-06', town: 'B' }),
      row({ month: '2025-03', town: 'C' }),
    ];
    expect(
      argMax(
        rs,
        (r) => r.month,
        (r) => r.town,
      ),
    ).toBe('B');
  });

  test('mode: most frequent (first to reach top count on ties)', () => {
    const rs = [row({ flat_model: 'X' }), row({ flat_model: 'Y' }), row({ flat_model: 'X' })];
    expect(mode(rs, (r) => r.flat_model)).toBe('X');
  });

  test('sampleN: all rows when under cap, else n rows', () => {
    const rs = [1, 2, 3];
    expect(sampleN(rs, 5)).toHaveLength(3);
    expect(sampleN(rs, 5)).toEqual([1, 2, 3]);
    expect(sampleN([1, 2, 3, 4, 5], 2)).toHaveLength(2);
  });

  test('monthsAgo: YYYY-MM, zero-padded, year rollover', () => {
    expect(monthsAgo(12, NOW)).toBe('2025-07');
    expect(monthsAgo(24, NOW)).toBe('2024-07');
    expect(monthsAgo(1, new Date('2026-01-10T00:00:00Z'))).toBe('2025-12');
  });

  test('yearOf', () => {
    expect(yearOf('2025-08')).toBe('2025');
  });
});

describe('toColumns', () => {
  test('transposes rows into typed columns; null → NaN', () => {
    const c = toColumns([row({ psf: 500, latitude: 1.3 }), row({ psf: null, latitude: null })]);
    expect(c.n).toBe(2);
    expect(c.resale_price).toBeInstanceOf(Float64Array);
    expect(c.postal).toBeInstanceOf(Int32Array);
    expect(c.psf[0]).toBe(500);
    expect(Number.isNaN(c.psf[1])).toBe(true);
    expect(Number.isNaN(c.latitude[1])).toBe(true);
    expect(c.town[0]).toBe('BEDOK');
  });
});

describe('recentQuery', () => {
  const rows = [
    row({ month: '2026-05', _ts: '2026-07-01', resale_price: 700000 }), // newest ingested → first
    row({ month: '2026-06', _ts: '2026-06-01', resale_price: 900000 }),
    row({ month: '2026-05', _ts: '2026-06-01', resale_price: 800000 }), // same _ts, older month → after
    row({ month: '2024-01', _ts: '2026-08-01', resale_price: 999999 }), // outside 12-month window → excluded
    row({ month: '2026-04', _ts: '2026-05-01', town: 'CLEMENTI', resale_price: 650000 }),
  ];

  test('12-month window + ORDER BY _ts DESC, month DESC', () => {
    const { rows: out, total } = recentQuery(
      cols(rows),
      { town: '__all', flat: '__all', page: 0, pageSize: 10 },
      NOW,
    );
    expect(total).toBe(4); // the 2024 row is filtered out (window is on month, not _ts)
    expect(out.map((r) => r.resale_price)).toEqual([700000, 900000, 800000, 650000]);
  });

  test('town filter + paging', () => {
    const c = cols(rows);
    const p0 = recentQuery(c, { town: 'BEDOK', flat: '__all', page: 0, pageSize: 2 }, NOW);
    expect(p0.total).toBe(3);
    expect(p0.rows).toHaveLength(2);
    const p1 = recentQuery(c, { town: 'BEDOK', flat: '__all', page: 1, pageSize: 2 }, NOW);
    expect(p1.rows).toHaveLength(1);
  });
});

describe('streetsQuery', () => {
  test('distinct, sorted, town-scoped', () => {
    const rows = [
      row({ town: 'BEDOK', street_name: 'B' }),
      row({ town: 'BEDOK', street_name: 'A' }),
      row({ town: 'BEDOK', street_name: 'A' }),
      row({ town: 'CLEMENTI', street_name: 'Z' }),
    ];
    expect(streetsQuery(cols(rows), 'BEDOK')).toEqual(['A', 'B']);
  });
});

describe('psfScatterQuery', () => {
  const rows = [
    row({ month: '2025-01', psf: 100, storey_lower_bound: 4 }),
    row({ month: '2025-01', psf: 200, storey_lower_bound: 10 }),
    row({ month: '2025-02', psf: 300, storey_lower_bound: 4 }),
    row({ month: '2025-02', psf: null }), // null psf excluded
    row({ month: '2024-01', psf: 999 }), // before monthFrom
    row({ town: 'CLEMENTI', month: '2025-03', psf: 500 }), // other town
  ];
  const spec = {
    town: 'BEDOK',
    street: '__all',
    storeyLo: null,
    storeyHi: null,
    leaseLo: null,
    leaseHi: null,
    monthFrom: '2025-01',
    cap: 6000,
  };

  test('filters, monthly medians ascending, total', () => {
    const { sample, monthly, total } = psfScatterQuery(cols(rows), spec);
    expect(total).toBe(3); // null psf + old + other-town excluded
    expect(sample).toHaveLength(3);
    expect(monthly.map((m) => m.month)).toEqual(['2025-01', '2025-02']);
    expect(monthly[0].med).toBe(150); // median(100,200)
    expect(monthly[1]).toEqual({ month: '2025-02', med: 300, n: 1 });
  });

  test('storey band + month window', () => {
    const { total } = psfScatterQuery(cols(rows), {
      ...spec,
      storeyLo: 3,
      storeyHi: 6,
      monthTo: '2025-01',
    });
    expect(total).toBe(1); // only 2025-01 storey 4
  });

  test('remaining-lease band', () => {
    const leaseRows = [
      row({ month: '2025-01', psf: 100, remaining_lease_years: 55 }),
      row({ month: '2025-01', psf: 200, remaining_lease_years: 70 }),
      row({ month: '2025-01', psf: 300, remaining_lease_years: 90 }),
    ];
    const { total } = psfScatterQuery(cols(leaseRows), {
      ...spec,
      leaseLo: 60,
      leaseHi: 80,
    });
    expect(total).toBe(1); // only the 70-year lease falls in [60, 80]
  });
});

describe('townMapQuery', () => {
  const rows = [
    row({ month: '2026-06', resale_price: 700000 }),
    row({ month: '2026-06', resale_price: 900000 }),
    row({ month: '2023-01', resale_price: 800000 }), // outside 24mo
    row({ month: '2026-05', latitude: null }), // no lat → excluded
    row({ flat_type: '3 ROOM', month: '2026-04' }), // other flat
  ];
  test('24-month window, lat present, flat filter, ordering', () => {
    const out = townMapQuery(cols(rows), { town: 'BEDOK', flat: '4 ROOM', street: '__all' }, NOW);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.price)).toEqual([900000, 700000]);
  });
});

describe('townRecordsQuery', () => {
  const rows = [
    row({ town: 'BEDOK', flat_type: '4 ROOM', resale_price: 500000 }),
    row({ town: 'BEDOK', flat_type: '4 ROOM', resale_price: 700000 }),
    row({ town: 'BEDOK', flat_type: '3 ROOM', resale_price: 400000 }),
    row({ town: 'CLEMENTI', flat_type: '4 ROOM', resale_price: 900000 }),
    row({ town: 'CLEMENTI', flat_type: '4 ROOM', resale_price: 600000 }),
  ];

  test('town mode: all sales in town, price DESC, per-flat median join', () => {
    const { rows: out, total } = townRecordsQuery(cols(rows), {
      town: 'BEDOK',
      scope: 'town',
      page: 0,
      pageSize: 10,
    });
    expect(total).toBe(3);
    expect(out.map((r) => r.price)).toEqual([700000, 500000, 400000]);
    // median of BEDOK 4 ROOM {500k,700k} = 600k, joined onto the 4 ROOM rows
    expect(out[0].med).toBe(600000);
    expect(out[2].med).toBe(400000); // lone 3 ROOM
  });

  test('global mode: peak per town across towns, distinct-town total', () => {
    const { rows: out, total } = townRecordsQuery(cols(rows), {
      town: 'x',
      scope: 'global',
      page: 0,
      pageSize: 10,
    });
    expect(total).toBe(2); // two distinct towns
    expect(out.map((r) => r.town)).toEqual(['CLEMENTI', 'BEDOK']); // 900k then 700k
    expect(out[1].med).toBe(600000); // BEDOK 4 ROOM median
  });
});

describe('resolveBlockQuery', () => {
  const rows = [
    row({
      postal: 460001,
      month: '2025-01',
      flat_model: 'Model A',
      lease_commence_date: 1985,
      flat_type: '4 ROOM',
    }),
    row({
      postal: 460001,
      month: '2025-06',
      town: 'BEDOK',
      address: 'A1',
      flat_model: 'Model A',
      lease_commence_date: 1985,
      flat_type: '4 ROOM',
    }),
    row({ postal: 460001, month: '2025-03', flat_type: '3 ROOM', flat_model: 'Improved' }),
  ];

  test('block identity (arg_max latest / mode) + flats by count DESC', () => {
    const m = resolveBlockQuery(cols(rows), 460001)!;
    expect(m.town).toBe('BEDOK');
    expect(m.address).toBe('A1'); // latest month 2025-06
    expect(m.model).toBe('Model A'); // 2 of 3
    expect(m.lc).toBe(1985);
    expect(m.flats).toEqual([
      { flat_type: '4 ROOM', n: 2 },
      { flat_type: '3 ROOM', n: 1 },
    ]);
  });

  test('unknown postal → null', () => {
    expect(resolveBlockQuery(cols(rows), 999999)).toBeNull();
  });
});

describe('storeysAreaQuery', () => {
  test('storey ranges by min lower-bound ASC + median area', () => {
    const rows = [
      row({
        postal: 1,
        flat_type: '4 ROOM',
        storey_range: '10 TO 12',
        storey_lower_bound: 10,
        floor_area_sqft: 1000,
      }),
      row({
        postal: 1,
        flat_type: '4 ROOM',
        storey_range: '01 TO 03',
        storey_lower_bound: 1,
        floor_area_sqft: 900,
      }),
      row({
        postal: 1,
        flat_type: '4 ROOM',
        storey_range: '01 TO 03',
        storey_lower_bound: 1,
        floor_area_sqft: 1100,
      }),
      row({ postal: 1, flat_type: '3 ROOM', storey_range: '20 TO 22', storey_lower_bound: 20 }), // other flat
    ];
    const { storeys, areaMedian } = storeysAreaQuery(cols(rows), 1, '4 ROOM');
    expect(storeys.map((s) => s.storey_range)).toEqual(['01 TO 03', '10 TO 12']);
    expect(areaMedian).toBe(1000); // median(1000, 900, 1100)
  });
});

describe('valuationQuery', () => {
  test('comps 12mo window, trajectory by year, lease HAVING thresholds', () => {
    const rows = Array.from({ length: 12 }, () =>
      row({
        town: 'BEDOK',
        flat_type: '4 ROOM',
        month: '2026-01',
        psf: 500,
        resale_price: 500000,
        remaining_lease_years: 70,
      }),
    );
    const v = valuationQuery(cols(rows), { town: 'BEDOK', flat: '4 ROOM' }, NOW);
    expect(v.months).toBe(12);
    expect(v.comps).toHaveLength(12);
    expect(v.island).toEqual({ psf: 500, price: 500000, area: 1000 });
    expect(v.trajectory).toEqual([{ yr: '2026', psf: 500, price: 500000, n: 12 }]);
    expect(v.leaseTown).toEqual([{ bucket: 70, psf: 500, n: 12 }]); // 12 >= 8
    expect(v.leaseIsland).toEqual([]); // 12 < 30 → excluded
  });

  test('widens comps to 24 months when the 12-month set is thin', () => {
    const recent = Array.from({ length: 5 }, () =>
      row({ town: 'BEDOK', flat_type: '4 ROOM', month: '2026-01' }),
    );
    const older = Array.from({ length: 6 }, () =>
      row({ town: 'BEDOK', flat_type: '4 ROOM', month: '2025-01' }),
    ); // in 24mo, not 12
    const v = valuationQuery(cols([...recent, ...older]), { town: 'BEDOK', flat: '4 ROOM' }, NOW);
    expect(v.months).toBe(24);
    expect(v.comps).toHaveLength(11);
  });

  // Queenstown-style mix: old low-rise blocks at ~$550 psf, young blocks at ~$1,100 psf.
  const mixedTown = (youngLat = 1.32) => [
    ...Array.from({ length: 20 }, () =>
      row({
        town: 'QUEENSTOWN',
        flat_type: '3 ROOM',
        month: '2026-03',
        psf: 550,
        remaining_lease_years: 47,
      }),
    ),
    ...Array.from({ length: 12 }, () =>
      row({
        town: 'QUEENSTOWN',
        flat_type: '3 ROOM',
        month: '2026-03',
        psf: 1100,
        remaining_lease_years: 88,
        latitude: youngLat,
      }),
    ),
  ];

  test('narrows comps to similar-lease sales nearby', () => {
    const v = valuationQuery(
      cols(mixedTown()),
      { town: 'QUEENSTOWN', flat: '3 ROOM', lease: 85, lat: 1.32, lng: 103.9 },
      NOW,
    );
    expect(v.scope).toBe('near');
    expect(v.comps).toHaveLength(12);
    expect(v.comps.every((c) => c.psf === 1100)).toBe(true);
    expect(v.town.price).toBe(500000); // town benchmark still spans every sale
  });

  test('falls back to similar lease town-wide when nothing similar is nearby', () => {
    const v = valuationQuery(
      cols(mixedTown(1.4)), // young blocks ~9 km away
      { town: 'QUEENSTOWN', flat: '3 ROOM', lease: 85, lat: 1.32, lng: 103.9 },
      NOW,
    );
    expect(v.scope).toBe('lease');
    expect(v.comps.every((c) => c.psf === 1100)).toBe(true);
  });

  test('nearby table rows: matched lease town-wide plus other leases within 1 km', () => {
    const rows = [
      ...mixedTown(), // old blocks at the flat's location, young blocks too
      row({
        town: 'QUEENSTOWN',
        flat_type: '3 ROOM',
        month: '2026-03',
        remaining_lease_years: 47,
        latitude: 1.4,
      }), // old + far
      row({
        town: 'QUEENSTOWN',
        flat_type: '3 ROOM',
        month: '2026-03',
        remaining_lease_years: 90,
        latitude: 1.4,
      }), // young + far
    ];
    const v = valuationQuery(
      cols(rows),
      { town: 'QUEENSTOWN', flat: '3 ROOM', lease: 85, lat: 1.32, lng: 103.9 },
      NOW,
    );
    expect(v.nearby).toHaveLength(33); // 20 old nearby + 12 young nearby + 1 young far
    expect(v.nearby.filter((r) => r.match)).toHaveLength(13);
    expect(v.nearby.find((r) => r.lat === 1.4)?.match).toBe(true);
    expect(v.nearby.filter((r) => !r.match).every((r) => r.lease === 47 && r.dist === 0)).toBe(
      true,
    );
  });

  test('uses every town sale when lease is unknown', () => {
    const v = valuationQuery(cols(mixedTown()), { town: 'QUEENSTOWN', flat: '3 ROOM' }, NOW);
    expect(v.scope).toBe('town');
    expect(v.comps).toHaveLength(32);
  });
});

// ---- valuationQuery: tier boundaries, widening, and bad inputs ----
// One town ('T'), user at (VLAT, VLNG) with 80 yrs left. Each fixture kind carries its own
// psf so a test can tell which rows became comps.
const VLAT = 1.32,
  VLNG = 103.9;
const NEAR_LAT = VLAT + 0.008; // ~890 m north
const FAR_LAT = VLAT + 0.01; // ~1112 m north
const vrow = (o: Partial<ResaleRow>): ResaleRow =>
  row({
    month: '2026-03',
    town: 'T',
    street_name: 'ST',
    remaining_lease_years: 80,
    latitude: VLAT,
    longitude: VLNG,
    ...o,
  });
const vmany = (n: number, o: Partial<ResaleRow>) => Array.from({ length: n }, () => vrow(o));
const vq = (
  rows: ResaleRow[],
  o: { lease?: number; lat?: number | null; lng?: number | null } = {},
  now: Date = NOW,
) =>
  valuationQuery(
    cols(rows),
    { town: 'T', flat: '4 ROOM', lease: 80, lat: VLAT, lng: VLNG, ...o },
    now,
  );
const NEAR = { psf: 1000 }; // similar lease, nearby
const LEASE_FAR = { psf: 800, latitude: FAR_LAT }; // similar lease, beyond 1 km
const OLD = { psf: 400, remaining_lease_years: 50 }; // dissimilar lease, nearby
const OLD24 = { month: '2025-01' }; // inside 24 months, outside 12

describe('valuationQuery tiers', () => {
  test('near: exactly 10 nearby similar-lease sales -> near/12', () => {
    const v = vq([...vmany(10, NEAR), ...vmany(30, LEASE_FAR)]);
    expect([v.scope, v.months, v.comps.length]).toEqual(['near', 12, 10]);
  });
  test('near: 9 -> falls to the lease tier', () => {
    const v = vq([...vmany(9, NEAR), ...vmany(30, LEASE_FAR)]);
    expect([v.scope, v.months, v.comps.length]).toEqual(['lease', 12, 39]);
  });
  test('radius: ~890 m is near, ~1112 m is not', () => {
    const v = vq([...vmany(10, { ...NEAR, latitude: NEAR_LAT }), ...vmany(10, LEASE_FAR)]);
    expect(v.scope).toBe('near');
    expect(v.comps.every((c) => c.psf === 1000)).toBe(true);
  });
  test('lease band is inclusive at ±10 years', () => {
    const v = vq([
      ...vmany(5, { remaining_lease_years: 90 }),
      ...vmany(5, { remaining_lease_years: 70 }),
    ]);
    expect([v.scope, v.comps.length]).toEqual(['near', 10]);
    expect(vq(vmany(10, { remaining_lease_years: 90.01 })).scope).toBe('town');
  });
  test('lease: exactly 5 -> lease/12; 4 -> town/12', () => {
    const five = vq([...vmany(5, LEASE_FAR), ...vmany(30, OLD)]);
    expect([five.scope, five.months, five.comps.length]).toEqual(['lease', 12, 5]);
    const four = vq([...vmany(4, LEASE_FAR), ...vmany(30, OLD)]);
    expect([four.scope, four.months, four.comps.length]).toEqual(['town', 12, 34]);
  });
  test('town: the last tier is used even under its minimum, at 24 months', () => {
    const v = vq([...vmany(3, OLD), ...vmany(2, { ...OLD, ...OLD24 })]);
    expect([v.scope, v.months, v.comps.length]).toEqual(['town', 24, 5]);
  });
  test('no lease or location: straight to the town tier', () => {
    const v = vq(vmany(10, OLD), { lease: 0, lat: null, lng: null });
    expect([v.scope, v.months, v.comps.length]).toEqual(['town', 12, 10]);
  });
});

describe('valuationQuery widens 12 -> 24 months before dropping a tier', () => {
  test('near/24 wins over lease/12', () => {
    const v = vq([...vmany(6, NEAR), ...vmany(4, { ...NEAR, ...OLD24 }), ...vmany(30, LEASE_FAR)]);
    expect([v.scope, v.months, v.comps.length]).toEqual(['near', 24, 10]);
  });
  test('lease/24 wins over town/12', () => {
    const v = vq([
      ...vmany(3, LEASE_FAR),
      ...vmany(2, { ...LEASE_FAR, ...OLD24 }),
      ...vmany(30, OLD),
    ]);
    expect([v.scope, v.months, v.comps.length]).toEqual(['lease', 24, 5]);
  });
  test('sales older than 24 months never count', () => {
    const v = vq([...vmany(9, NEAR), ...vmany(5, { ...NEAR, month: '2024-06' })]);
    expect([v.scope, v.comps.length]).toEqual(['lease', 9]);
  });
  test('the cutoff month is inclusive', () => {
    expect(monthsAgo(12, NOW)).toBe('2025-07');
    const v = vq(vmany(10, { ...NEAR, month: '2025-07' }));
    expect([v.scope, v.months]).toEqual(['near', 12]);
  });
});

describe('valuationQuery with no comps', () => {
  test('no sales at all: town/24, empty, zero medians, no last sale', () => {
    const v = vq([]);
    expect([v.scope, v.months, v.comps.length, v.nearby.length]).toEqual(['town', 24, 0, 0]);
    expect(v.town).toEqual({ price: 0, area: 0 });
    expect(v.lastSale).toBe('');
  });
  test('only older sales: empty comps but the last sale month is reported', () => {
    const v = vq([...vmany(3, { month: '2021-12' }), ...vmany(2, { month: '2020-05' })]);
    expect(v.comps).toHaveLength(0);
    expect(v.lastSale).toBe('2021-12');
  });
  test('scope, months and comps stay consistent when the town tier ends at 24', () => {
    const v = vq([...vmany(2, OLD), ...vmany(3, { ...OLD, ...OLD24 })]);
    expect(v.months).toBe(24);
    expect(v.comps.map((c) => c.month).sort()).toEqual([
      '2025-01',
      '2025-01',
      '2025-01',
      '2026-03',
      '2026-03',
    ]);
  });
});

describe('valuationQuery location and lease inputs', () => {
  test('null, one-sided or NaN user coords skip the near tier and give null distances', () => {
    for (const o of [{ lat: null, lng: null }, { lng: null }, { lat: NaN, lng: NaN }]) {
      const v = vq(vmany(20, NEAR), o);
      expect(v.scope).toBe('lease');
      expect(v.nearby.every((r) => r.dist === null)).toBe(true);
    }
  });
  test('lat/lng 0 is a real (far away) location, not "missing"', () => {
    const v = vq(vmany(20, NEAR), { lat: 0, lng: 0 });
    expect(v.scope).toBe('lease');
    expect(v.nearby[0].dist).toBeGreaterThan(1e7);
  });
  test('a comp missing either coordinate has a null distance and is never near', () => {
    for (const bad of [{ latitude: null }, { longitude: null }]) {
      const v = vq([...vmany(9, NEAR), vrow({ ...NEAR, ...bad })]);
      expect(v.scope).toBe('lease');
      expect(v.nearby.filter((r) => r.dist === null)).toHaveLength(1);
    }
  });
  test('unknown lease (0, negative or NaN): town tier, every town sale is a table match', () => {
    for (const lease of [0, -5, NaN]) {
      const v = vq([...vmany(10, NEAR), ...vmany(10, { ...OLD, latitude: FAR_LAT })], { lease });
      expect(v.scope).toBe('town');
      expect(v.nearby).toHaveLength(20);
      expect(v.nearby.every((r) => r.match)).toBe(true);
    }
  });
  test('a comp with no remaining lease is never "similar" and has no lease bucket', () => {
    const v = vq(vmany(10, { remaining_lease_years: null as unknown as number }));
    expect(v.scope).toBe('town');
    expect(v.nearby.every((r) => !r.match)).toBe(true);
    expect(v.leaseTown).toHaveLength(0);
  });
  test('sales without a PSF never become comps or table rows', () => {
    const v = vq([...vmany(10, NEAR), ...vmany(5, { ...NEAR, psf: null })]);
    expect(v.comps).toHaveLength(10);
    expect(v.nearby).toHaveLength(10);
    expect(v.comps.every((c) => c.psf === 1000)).toBe(true);
  });
});

describe('valuationQuery table rows and benchmark', () => {
  test('nearby: lease matches anywhere in town, other leases only within 1 km', () => {
    const v = vq([
      ...vmany(10, NEAR),
      vrow(LEASE_FAR),
      vrow({ ...OLD, latitude: NEAR_LAT }),
      vrow({ ...OLD, latitude: FAR_LAT }),
    ]);
    expect(v.nearby).toHaveLength(12);
    const far = v.nearby.find((r) => r.psf === 800)!;
    expect(far.match).toBe(true);
    expect(far.dist!).toBeGreaterThan(1100);
    const other = v.nearby.find((r) => r.psf === 400)!;
    expect(other.match).toBe(false);
    expect(other.dist!).toBeGreaterThan(880);
    expect(other.dist!).toBeLessThan(900);
  });
  test('other-lease rows drop out when the flat has no location', () => {
    const v = vq([...vmany(10, NEAR), ...vmany(5, OLD)], { lat: null, lng: null });
    expect(v.nearby).toHaveLength(10);
  });
  test('nearby spans the chosen window, wider than the comps', () => {
    const v = vq([
      ...vmany(6, NEAR),
      ...vmany(4, { ...NEAR, ...OLD24 }),
      ...vmany(3, { ...LEASE_FAR, ...OLD24 }),
    ]);
    expect([v.scope, v.months, v.comps.length, v.nearby.length]).toEqual(['near', 24, 10, 13]);
  });
  test('town benchmark stays on 12 months when the comps widen to 24', () => {
    const v = vq([
      ...vmany(5, { ...NEAR, resale_price: 600000 }),
      ...vmany(20, { ...NEAR, ...OLD24, resale_price: 100000 }),
    ]);
    expect(v.months).toBe(24);
    expect(v.town.price).toBe(600000);
  });
  test('town benchmark falls back to 24 months only when 12 has no sales', () => {
    const v = vq(vmany(3, { ...NEAR, ...OLD24, resale_price: 100000 }));
    expect(v.town.price).toBe(100000);
  });
});

describe('monthsAgo at month ends', () => {
  // Local-time constructors so the expectations don't depend on the TZ.
  test('crosses the year from Jan', () => {
    expect(monthsAgo(12, new Date(2026, 0, 1))).toBe('2025-01');
    expect(monthsAgo(24, new Date(2026, 0, 31))).toBe('2024-01');
  });
  test('no overflow from the 31st or a leap day', () => {
    expect(monthsAgo(12, new Date(2026, 6, 31))).toBe('2025-07');
    expect(monthsAgo(36, new Date(2026, 11, 31))).toBe('2023-12');
    expect(monthsAgo(1, new Date(2026, 2, 31))).toBe('2026-02');
    expect(monthsAgo(12, new Date(2028, 1, 29))).toBe('2027-02');
  });
  test('a sale in the cutoff month is in; one month earlier is out', () => {
    const v = vq(
      [...vmany(10, { ...NEAR, month: '2025-01' }), ...vmany(10, { ...NEAR, month: '2024-12' })],
      {},
      new Date(2026, 0, 1),
    );
    expect([v.scope, v.months, v.comps.length]).toEqual(['near', 12, 10]);
  });
});
