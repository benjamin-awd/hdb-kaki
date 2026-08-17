"""Build the MRT/LRT line geometry drawn beneath the nearest-station walk on My Flat Insights.

Emits a committed ``web/public/geo/mrt-lines.geojson`` — one LineString per rail line, its
stations strung together in code order (NS1 → NS2 → … ), tagged with the line's brand colour:

    { "type": "FeatureCollection", "features": [
      { "type": "Feature",
        "properties": { "line": "NS", "color": "#d42e12" },
        "geometry": { "type": "LineString", "coordinates": [[lng, lat], ...] } }, ... ] }

The page loads this once and draws only the line(s) the nearest station sits on, so the map
shows the corridor without turning into a full network diagram.

Source of truth: ``webapp/update/rail_stations.py`` (RAIL_STATIONS) — the same committed table
as build_mrt_stations.py. An interchange entry (codes "CC15 / NS17") contributes its point to
every line it names, so corridors are stitched from the merged station list. Geometry is
*schematic* — straight segments between consecutive stations, not the true curved track — which
reads fine at town zoom.

Stations change rarely, so the output is committed and this runs on demand, not in the daily ETL:

    uv run python webapp/update/build_mrt_lines.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from rail_stations import RAIL_STATIONS

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "geo" / "mrt-lines.geojson"

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
    "DE": "#0055b8",  # Downtown Line western extension (Sungei Kadut)
    "TE": "#9d5b25",
    "CR": "#97c616",  # Cross Island Line (Lime)
    "CP": "#97c616",  # Cross Island Line — Punggol Extension
    "JS": "#0099aa",  # Jurong Region Line (Teal)
    "JW": "#0099aa",  # Jurong Region Line — west branch
    "JE": "#0099aa",  # Jurong Region Line — east branch
    "BP": "#5b544a",
    "STC": "#5b544a",
    "SW": "#5b544a",
    "SE": "#5b544a",
    "PTC": "#5b544a",
    "PW": "#5b544a",
    "PE": "#5b544a",
}

_CODE = re.compile(r"^([A-Z]+)(\d*)")

# Loop LRT services are closed rings through their interchange hub, not open polylines: the
# corridor runs hub → stop 1 → … → stop N → hub. The hub is a different code prefix (PTC/STC),
# so it never joins the loop's own stop list — stitch it onto both ends here. Prefix → hub code.
LOOP_HUBS: dict[str, str] = {
    "PW": "PTC",  # Punggol West Loop, through Punggol
    "PE": "PTC",  # Punggol East Loop, through Punggol
    "SW": "STC",  # Sengkang West Loop, through Sengkang
    "SE": "STC",  # Sengkang East Loop, through Sengkang
}

# Bukit Panjang LRT is a lollipop, not a line: a BP1→BP6 trunk, then a one-way loop
# BP6→BP7→…→BP13 that rejoins the trunk at BP6 (Bukit Panjang). Numeric order already walks the
# trunk and up the loop; appending the junction's point closes the ring. (BP14 Ten Mile Junction
# closed in 2019 and is no longer in the dataset.)
LOOP_BACK: dict[str, str] = {"BP": "BP6"}


def _point_by_code() -> dict[str, tuple[float, float]]:
    """Map every station code to its (lng, lat), so loop hubs can be stitched into corridors."""
    pts: dict[str, tuple[float, float]] = {}
    for s in RAIL_STATIONS:
        for code in re.split(r"\s*/\s*", s["codes"]):
            code = code.strip()
            if code:
                pts[code] = (float(s["lng"]), float(s["lat"]))
    return pts


def build() -> None:
    points = _point_by_code()

    # Group stops by line prefix; keep each stop's running number so we can order the corridor.
    # Interchanges (codes "CC15 / NS17") add their single point to every line they name.
    # Numberless hub codes (STC, PTC) sort first at 0.
    lines: dict[str, list[tuple[int, float, float]]] = {}
    for s in RAIL_STATIONS:
        for code in re.split(r"\s*/\s*", s["codes"]):
            m = _CODE.match(code.strip())
            if not m:
                continue
            prefix, num = m.group(1), m.group(2)
            if prefix not in LINE_COLORS:
                continue
            lines.setdefault(prefix, []).append(
                (int(num) if num else 0, float(s["lng"]), float(s["lat"]))
            )

    features = []
    for prefix, stops in sorted(lines.items()):
        ordered = sorted(stops, key=lambda s: s[0])
        if len(ordered) < 2:
            continue  # a single stop makes no line
        pts = [(lng, lat) for _, lng, lat in ordered]

        # Close loop services back through their interchange hub (PTC/STC).
        hub = LOOP_HUBS.get(prefix)
        if hub and hub in points:
            pts = [points[hub], *pts, points[hub]]
        # Rejoin a lollipop loop (Bukit Panjang) at its junction station.
        elif prefix in LOOP_BACK and LOOP_BACK[prefix] in points:
            pts.append(points[LOOP_BACK[prefix]])

        coords = [[round(lng, 5), round(lat, 5)] for lng, lat in pts]
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
