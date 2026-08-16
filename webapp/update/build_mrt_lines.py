"""Build the MRT/LRT line geometry drawn beneath the nearest-station walk on My Flat Insights.

Emits a committed ``web/public/geo/mrt-lines.geojson`` — one LineString per rail line, its
stations strung together in code order (NS1 → NS2 → … ), tagged with the line's brand colour:

    { "type": "FeatureCollection", "features": [
      { "type": "Feature",
        "properties": { "line": "NS", "color": "#d42e12" },
        "geometry": { "type": "LineString", "coordinates": [[lng, lat], ...] } }, ... ] }

The page loads this once and draws only the line(s) the nearest station sits on, so the map
shows the corridor without turning into a full network diagram.

Source: the same LTA train-station CSV as build_mrt_stations.py (Open Data Licence, via the
``datadoubleconfirm`` mirror). The geometry is therefore *schematic* — straight segments between
consecutive stations, not the true curved track — which reads fine at town zoom. Stations change
rarely, so the output is committed and this runs on demand, not in the daily ETL:

    uv run python webapp/update/build_mrt_lines.py

Caveat: the mirror predates the full Thomson-East Coast Line build-out (see build_mrt_stations.py).
For true track geometry, swap the source for LTA/OneMap rail-line polylines and re-emit here.
"""

from __future__ import annotations

import csv
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "geo" / "mrt-lines.geojson"

SRC_CSV = "https://raw.githubusercontent.com/hxchua/datadoubleconfirm/master/datasets/mrtsg.csv"

# Line colours, keyed by station-code prefix. Heavy-rail lines carry their official hue; every
# LRT prefix collapses to ink-2 — matching the frontend's lineColor() so lines and station icons
# agree. Kept deliberately in sync with LINE_COLORS in web/src/pages/my-flat-insights.astro.
LINE_COLORS: dict[str, str] = {
    "NS": "#d42e12",
    "EW": "#009645",
    "CG": "#009645",
    "NE": "#9f4c9c",
    "CC": "#f79500",
    "CE": "#f79500",
    "DT": "#0055b8",
    "TE": "#9d5b25",
    "BP": "#5b544a",
    "STC": "#5b544a",
    "SW": "#5b544a",
    "SE": "#5b544a",
    "PTC": "#5b544a",
    "PW": "#5b544a",
    "PE": "#5b544a",
}

_CODE = re.compile(r"^([A-Z]+)(\d*)$")


def _fetch_csv(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (hdb-kaki build)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def build() -> None:
    rows = list(csv.DictReader(io.StringIO(_fetch_csv(SRC_CSV))))

    # Group stops by line prefix; keep each stop's running number so we can order the corridor.
    # Numberless hub codes (STC, PTC) sort first at 0.
    lines: dict[str, list[tuple[int, float, float]]] = {}
    for row in rows:
        code = (row.get("STN_NO") or "").strip()
        m = _CODE.match(code)
        if not m:
            continue
        prefix, num = m.group(1), m.group(2)
        if prefix not in LINE_COLORS:
            continue
        lines.setdefault(prefix, []).append(
            (int(num) if num else 0, float(row["Longitude"]), float(row["Latitude"]))
        )

    features = []
    for prefix, stops in sorted(lines.items()):
        ordered = sorted(stops, key=lambda s: s[0])
        if len(ordered) < 2:
            continue  # a single stop makes no line
        coords = [[round(lng, 5), round(lat, 5)] for _, lng, lat in ordered]
        features.append(
            {
                "type": "Feature",
                "properties": {"line": prefix, "color": LINE_COLORS[prefix]},
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features}, separators=(",", ":")
        )
    )
    print(
        f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB, "
        f"{len(features)} lines)"
    )


if __name__ == "__main__":
    build()
