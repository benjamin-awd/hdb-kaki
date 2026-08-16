"""Build the MRT/LRT station list used by My Flat Insights' "walk to nearest MRT".

Emits a compact, committed ``web/public/geo/mrt-stations.json`` — one entry per
physical station (interchanges collapsed to a single point, line codes merged):

    [{"name": "Bishan", "codes": "CC15 / NS17", "lat": 1.35102, "lng": 103.84882}, ...]

The page loads this once, picks the station nearest the resolved flat by great-circle
distance, and then asks the OneMap routing proxy for the actual walking path to it.

Source: LTA train-station coordinates (Open Data Licence), via the widely-mirrored
``datadoubleconfirm`` CSV. Like the boundary GeoJSONs (build_town_geojson.py), stations
change rarely, so the output is committed and this runs on demand, not in the daily ETL:

    uv run python webapp/update/build_mrt_stations.py

Caveat: this mirror predates the full Thomson-East Coast Line build-out, so a handful of
the newest stations may be missing. When a OneMap token is available, refresh from the
authoritative OneMap Themes service instead (queryName=trainstation) and re-emit here.
"""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "geo" / "mrt-stations.json"

SRC_CSV = "https://raw.githubusercontent.com/hxchua/datadoubleconfirm/master/datasets/mrtsg.csv"


def _clean_name(raw: str) -> str:
    """ "ADMIRALTY MRT STATION" -> "Admiralty"; keep interchange base names stable."""
    name = raw.strip().upper()
    for suffix in (" MRT STATION", " LRT STATION", " MRT", " LRT"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    return name.title()


def _fetch_csv(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (hdb-kaki build)"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def build() -> None:
    rows = list(csv.DictReader(io.StringIO(_fetch_csv(SRC_CSV))))

    # Group per physical station: interchanges appear once per line code (Jurong East =
    # EW24 + NS1) at ~the same point. Merge codes and average the coordinates.
    grouped: dict[str, dict] = {}
    for row in rows:
        name = _clean_name(row["STN_NAME"])
        lat, lng = float(row["Latitude"]), float(row["Longitude"])
        g = grouped.setdefault(name, {"codes": set(), "lats": [], "lngs": []})
        if row.get("STN_NO"):
            g["codes"].add(row["STN_NO"].strip())
        g["lats"].append(lat)
        g["lngs"].append(lng)

    stations = [
        {
            "name": name,
            "codes": " / ".join(sorted(g["codes"])),
            "lat": round(sum(g["lats"]) / len(g["lats"]), 5),
            "lng": round(sum(g["lngs"]) / len(g["lngs"]), 5),
        }
        for name, g in sorted(grouped.items())
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(stations, separators=(",", ":")))
    print(
        f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB, "
        f"{len(stations)} stations)"
    )


if __name__ == "__main__":
    build()
