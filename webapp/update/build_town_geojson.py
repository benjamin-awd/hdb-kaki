"""Build the HDB-town boundary GeoJSON used by the landing-page choropleth.

Fetches the URA Master Plan 2019 Planning Area boundaries from data.gov.sg, folds the
55 planning areas into the 26 HDB resale "towns" the price data uses, dissolves each
town into a single (multi)polygon, simplifies the geometry, and writes a compact
``web/public/geo/sg-towns.geojson``.

Unlike the price artifacts (``web/public/data/``, regenerated daily by ``emit_web.py``),
these boundaries change only when URA revises the Master Plan — a ~5-year statutory
cycle — so the output is committed to the repo and this script is run on demand rather
than in the daily ETL. Run it with shapely available, e.g. from the repo root:

    uv run --with shapely python webapp/update/build_town_geojson.py

Planning-area -> HDB-town mapping (the price data's ``town`` values):
  * 24 areas map 1:1 by identical name (ANG MO KIO, BEDOK, ...).
  * KALLANG (planning area) -> "KALLANG/WHAMPOA" (Whampoa is a subzone within Kallang).
  * The 11 Central Area planning areas (flagged CA_IND='Y': Downtown Core, Outram,
    Rochor, Museum, Newton, Orchard, River Valley, Singapore River, Marina South,
    Marina East, Straits View) dissolve into the single HDB "CENTRAL AREA" town.
Planning areas with no HDB resale town (Tuas, Changi, Paya Lebar, water catchments,
...) are kept as neutral "no data" base geometry so the map stays a complete island —
many sit inside the landmass and dropping them would punch holes through it. Only the
offshore island groups are dropped, to keep the map's frame tight on the mainland.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "geo" / "sg-towns.geojson"

# URA Master Plan 2019 Planning Area Boundary (No Sea), GEOJSON. The dataset id is
# stable; data.gov.sg hands back a short-lived signed download URL via poll-download.
DATASET_ID = "d_4765db0e87b9c86336792efe8a1f7a66"
POLL_URL = f"https://api-open.data.gov.sg/v1/public/api/datasets/{DATASET_ID}/poll-download"

# HDB towns whose name is not identical to the URA planning area it comes from.
RENAME = {"KALLANG": "KALLANG/WHAMPOA"}

# Douglas-Peucker tolerance in degrees (~0.0003 deg ~= 33 m). Small enough that town
# outlines stay recognisable, large enough to shrink the file to well under ~200 KB.
SIMPLIFY_TOLERANCE = 0.0003
COORD_PRECISION = 5  # decimal places; ~1 m, plenty for a choropleth


def _get_json(url: str, timeout: int) -> dict:
    # data.gov.sg's S3 blobs 403 the default urllib user-agent; send a browser-like one.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (hdb-kaki build)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _fetch_planning_areas() -> dict:
    url = _get_json(POLL_URL, 30)["data"]["url"]
    return _get_json(url, 60)


def _town_for(props: dict) -> str | None:
    """Return the HDB town a planning area belongs to, or None to drop it."""
    if props.get("CA_IND") == "Y":
        return "CENTRAL AREA"
    name = props["PLN_AREA_N"].strip().upper()
    return RENAME.get(name, name)


def _round(geom: dict, ndigits: int) -> dict:
    """Recursively round every coordinate in a GeoJSON geometry mapping."""

    def r(x):
        if isinstance(x, (int, float)):
            return round(x, ndigits)
        return [r(v) for v in x]

    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def build() -> None:
    src = _fetch_planning_areas()

    # The 26 towns the price data uses — every HDB town must resolve to one of these.
    valid = {
        "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT BATOK", "BUKIT MERAH", "BUKIT PANJANG",
        "BUKIT TIMAH", "CENTRAL AREA", "CHOA CHU KANG", "CLEMENTI", "GEYLANG", "HOUGANG",
        "JURONG EAST", "JURONG WEST", "KALLANG/WHAMPOA", "MARINE PARADE", "PASIR RIS",
        "PUNGGOL", "QUEENSTOWN", "SEMBAWANG", "SENGKANG", "SERANGOON", "TAMPINES",
        "TOA PAYOH", "WOODLANDS", "YISHUN",
    }

    # Collect each town's constituent planning-area polygons for dissolving, and keep
    # the remaining (non-HDB) mainland areas so the map stays a complete island — many
    # of them (Central Water Catchment, Paya Lebar, Novena, Tanglin, ...) sit *inside*
    # the landmass, so dropping them would punch holes through it. They carry no resale
    # data and render as neutral "no data" grey. The offshore island groups are dropped:
    # they're small specks far from the mainland that would only widen the map's frame.
    DROP = {"NORTH-EASTERN ISLANDS", "SOUTHERN ISLANDS", "WESTERN ISLANDS"}

    parts: dict[str, list] = {}
    others: list[tuple[str, object]] = []
    for f in src["features"]:
        props = f["properties"]
        town = _town_for(props)
        if town in valid:
            parts.setdefault(town, []).append(shape(f["geometry"]))
        elif props["PLN_AREA_N"].strip().upper() not in DROP:
            others.append((props["PLN_AREA_N"].strip().upper(), shape(f["geometry"])))

    missing = valid - parts.keys()
    if missing:
        raise SystemExit(f"No planning-area geometry for towns: {sorted(missing)}")

    features = []
    # HDB towns (dissolved) — hdb:true, keyed by town so overview.json medians join on.
    for town in sorted(parts):
        dissolved = unary_union(parts[town]).simplify(SIMPLIFY_TOLERANCE)
        features.append({
            "type": "Feature",
            "properties": {"name": town, "hdb": True},
            "geometry": _round(mapping(dissolved), COORD_PRECISION),
        })
    # Non-HDB areas — hdb:false, drawn as no-data base geometry only.
    for name, geom in sorted(others):
        features.append({
            "type": "Feature",
            "properties": {"name": name, "hdb": False},
            "geometry": _round(mapping(geom.simplify(SIMPLIFY_TOLERANCE)), COORD_PRECISION),
        })

    fc = {"type": "FeatureCollection", "features": features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fc, separators=(",", ":")))
    n_hdb = len(parts)
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB, "
          f"{n_hdb} towns + {len(features) - n_hdb} no-data areas)")


if __name__ == "__main__":
    build()
