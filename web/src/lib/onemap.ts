// Geo helpers for My Flat Insights: pick the MRT station nearest the flat and measure the
// straight-line distance to it. All client-side — nothing leaves the browser.

export type LatLng = [number, number];
export type Station = { name: string; codes: string; lat: number; lng: number };

// Great-circle distance in metres, used to rank stations and report distance to the nearest.
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The `k` stations closest to (lat, lng), nearest first, each with its straight-line
// distance in metres. `k` is clamped to [0, stations.length]. Used by My Flat Insights to
// route to the nearest and list the next-nearest as context.
export function nearbyStations(
  lat: number,
  lng: number,
  stations: Station[],
  k = 3,
): { station: Station; meters: number }[] {
  return stations
    .map((station) => ({
      station,
      meters: haversineMeters([lat, lng], [station.lat, station.lng]),
    }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, Math.max(0, k));
}

// The station closest to (lat, lng), with its straight-line distance in metres — the k=1
// case of nearbyStations.
export function nearestStation(
  lat: number,
  lng: number,
  stations: Station[],
): { station: Station; meters: number } | null {
  return nearbyStations(lat, lng, stations, 1)[0] ?? null;
}
