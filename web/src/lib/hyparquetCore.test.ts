import { test, expect, describe } from 'bun:test';
import {
  median,
  quantileSorted,
  argMax,
  mode,
  sampleN,
  monthsAgo,
  yearOf,
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

describe('recentQuery', () => {
  const rows = [
    row({ month: '2026-06', resale_price: 700000 }),
    row({ month: '2026-06', resale_price: 900000 }), // same month, higher price → first
    row({ month: '2026-05', resale_price: 800000 }),
    row({ month: '2024-01', resale_price: 999999 }), // outside 12-month window → excluded
    row({ month: '2026-04', town: 'CLEMENTI', resale_price: 650000 }),
  ];

  test('12-month window + ORDER BY month DESC, price DESC', () => {
    const { rows: out, total } = recentQuery(
      rows,
      { town: '__all', flat: '__all', page: 0, pageSize: 10 },
      NOW,
    );
    expect(total).toBe(4); // the 2024 row is filtered out
    expect(out.map((r) => r.resale_price)).toEqual([900000, 700000, 800000, 650000]);
  });

  test('town filter + paging', () => {
    const p0 = recentQuery(rows, { town: 'BEDOK', flat: '__all', page: 0, pageSize: 2 }, NOW);
    expect(p0.total).toBe(3);
    expect(p0.rows).toHaveLength(2);
    const p1 = recentQuery(rows, { town: 'BEDOK', flat: '__all', page: 1, pageSize: 2 }, NOW);
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
    expect(streetsQuery(rows, 'BEDOK')).toEqual(['A', 'B']);
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
    monthFrom: '2025-01',
    cap: 6000,
  };

  test('filters, monthly medians ascending, total', () => {
    const { sample, monthly, total } = psfScatterQuery(rows, spec);
    expect(total).toBe(3); // null psf + old + other-town excluded
    expect(sample).toHaveLength(3);
    expect(monthly.map((m) => m.month)).toEqual(['2025-01', '2025-02']);
    expect(monthly[0].med).toBe(150); // median(100,200)
    expect(monthly[1]).toEqual({ month: '2025-02', med: 300, n: 1 });
  });

  test('storey band + month window', () => {
    const { total } = psfScatterQuery(rows, {
      ...spec,
      storeyLo: 3,
      storeyHi: 6,
      monthTo: '2025-01',
    });
    expect(total).toBe(1); // only 2025-01 storey 4
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
    const out = townMapQuery(rows, { town: 'BEDOK', flat: '4 ROOM', street: '__all' }, NOW);
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
    const { rows: out, total } = townRecordsQuery(rows, {
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
    const { rows: out, total } = townRecordsQuery(rows, {
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
    const m = resolveBlockQuery(rows, 460001)!;
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
    expect(resolveBlockQuery(rows, 999999)).toBeNull();
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
    const { storeys, areaMedian } = storeysAreaQuery(rows, 1, '4 ROOM');
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
    const v = valuationQuery(rows, { town: 'BEDOK', flat: '4 ROOM' }, NOW);
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
    const v = valuationQuery([...recent, ...older], { town: 'BEDOK', flat: '4 ROOM' }, NOW);
    expect(v.months).toBe(24);
    expect(v.comps).toHaveLength(11);
  });
});
