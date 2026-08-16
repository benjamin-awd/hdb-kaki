"""Build the MRT/LRT station list used by My Flat Insights' "walk to nearest MRT".

Emits a compact, committed ``web/public/geo/mrt-stations.json`` — one entry per
physical station (interchanges collapsed to a single point, line codes merged):

    [{"name": "Bishan", "codes": "CC15 / NS17", "lat": 1.35102, "lng": 103.84882}, ...]

Future (not-yet-open) stations carry an extra ``"opening"`` year; the page still
picks them as "nearest" but labels them so they aren't mistaken for a running station:

    {"name": "Mayflower", "codes": "TE6", "lat": 1.37146, "lng": 103.83657}
    {"name": "Aviation Park", "codes": "CR2", "lat": 1.3846, "lng": 103.988, "opening": 2030}

The page loads this once, picks the station nearest the resolved flat by great-circle
distance, and then asks the OneMap routing proxy for the actual walking path to it.

Source of truth: ``webapp/update/rail_stations.py`` (RAIL_STATIONS) — a committed,
hand-maintained table covering the whole current network plus every announced future
line (Cross Island, Jurong Region, Circle Line 6, TEL/DTL/NSL build-out). Operational
coordinates were geocoded from OneMap (the authoritative LTA source); future-station
coordinates are best-available planning locations. This replaces the old
``datadoubleconfirm`` CSV mirror, which predated the Thomson-East Coast Line build-out
and so silently dropped Mayflower and most of the brown line.

Stations change rarely, so the output is committed and this runs on demand, not in the
daily ETL. When a line opens or a station is confirmed, edit RAIL_STATIONS and re-run:

    uv run python webapp/update/build_mrt_stations.py
"""

from __future__ import annotations

import json
from pathlib import Path

from rail_stations import RAIL_STATIONS

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "geo" / "mrt-stations.json"


def build() -> None:
    stations = []
    for s in sorted(RAIL_STATIONS, key=lambda s: s["name"]):
        entry = {
            "name": s["name"],
            "codes": s["codes"],
            "lat": round(s["lat"], 5),
            "lng": round(s["lng"], 5),
        }
        if s.get("opening") is not None:
            entry["opening"] = s["opening"]  # year (int) or a phrase like "TBA"
        stations.append(entry)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(stations, separators=(",", ":")))
    future = sum(1 for s in stations if "opening" in s)
    print(
        f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB, "
        f"{len(stations)} stations, {future} future)"
    )


if __name__ == "__main__":
    build()
