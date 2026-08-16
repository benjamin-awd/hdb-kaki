import { test, expect, describe } from 'bun:test';
import { haversineMeters, nearbyStations, nearestStation, type Station } from './onemap';

describe('haversineMeters', () => {
  test('is zero for identical points', () => {
    expect(haversineMeters([1.35, 103.85], [1.35, 103.85])).toBe(0);
  });

  test('~111 m per 0.001° of latitude', () => {
    expect(haversineMeters([1.3, 103.8], [1.301, 103.8])).toBeCloseTo(111, 0);
  });

  test('is symmetric', () => {
    const a: [number, number] = [1.2931, 103.852];
    const b: [number, number] = [1.351, 103.8486];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('nearestStation', () => {
  const stations: Station[] = [
    { name: 'Bishan', codes: 'CC15 / NS17', lat: 1.35107, lng: 103.84864 },
    { name: 'Ang Mo Kio', codes: 'NS16', lat: 1.36993, lng: 103.84955 },
    { name: 'Jurong East', codes: 'EW24 / NS1', lat: 1.33315, lng: 103.74231 },
  ];

  test('returns the closest station and its distance', () => {
    const r = nearestStation(1.3505, 103.848, stations)!;
    expect(r.station.name).toBe('Bishan');
    expect(r.meters).toBeLessThan(600);
  });

  test('a point out west resolves to Jurong East', () => {
    expect(nearestStation(1.333, 103.743, stations)!.station.name).toBe('Jurong East');
  });

  test('empty list yields null', () => {
    expect(nearestStation(1.35, 103.85, [])).toBeNull();
  });
});

describe('nearbyStations', () => {
  const stations: Station[] = [
    { name: 'Bishan', codes: 'CC15 / NS17', lat: 1.35107, lng: 103.84864 },
    { name: 'Ang Mo Kio', codes: 'NS16', lat: 1.36993, lng: 103.84955 },
    { name: 'Jurong East', codes: 'EW24 / NS1', lat: 1.33315, lng: 103.74231 },
  ];

  test('returns k stations sorted nearest-first', () => {
    const near = nearbyStations(1.3505, 103.848, stations, 2);
    expect(near.map((n) => n.station.name)).toEqual(['Bishan', 'Ang Mo Kio']);
    expect(near[0].meters).toBeLessThan(near[1].meters);
  });

  test('k larger than the list returns every station', () => {
    expect(nearbyStations(1.35, 103.85, stations, 99).length).toBe(3);
  });

  test('k of zero returns nothing', () => {
    expect(nearbyStations(1.35, 103.85, stations, 0)).toEqual([]);
  });

  test('agrees with nearestStation on the closest', () => {
    const first = nearbyStations(1.3505, 103.848, stations)[0];
    expect(first.station.name).toBe(nearestStation(1.3505, 103.848, stations)!.station.name);
  });
});
