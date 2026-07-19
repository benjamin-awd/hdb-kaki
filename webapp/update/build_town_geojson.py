"""Build the boundary GeoJSON used by the landing-page choropleth.

Fetches URA Master Plan 2019 boundaries from data.gov.sg and writes three compact,
committed assets under ``web/public/geo/``:
  * ``sg-towns.geojson``    — the 26 HDB resale "towns" the price data uses.
  * ``sg-subzones.geojson`` — the ~330 URA subzones, for the finer choropleth level
    (transactions are point-in-polygon'd into these by ``emit_web.py``).
  * ``sg-outline.geojson``  — the dissolved coastline, drawn as a crisp country outline.

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

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
GEO_DIR = ROOT / "web" / "public" / "geo"
OUT = GEO_DIR / "sg-towns.geojson"
SUBZONES = GEO_DIR / "sg-subzones.geojson"
OUTLINE = GEO_DIR / "sg-outline.geojson"

# URA Master Plan 2019 boundary datasets (No Sea), GEOJSON. The dataset ids are stable;
# data.gov.sg hands back a short-lived signed download URL via poll-download.
DATASET_ID = "d_4765db0e87b9c86336792efe8a1f7a66"  # planning areas
SUBZONE_DATASET_ID = "d_8594ae9ff96d0c708bc2af633048edfb"  # subzones

# Offshore island planning areas — dropped from every layer: small specks far from the
# mainland that would only widen the map's frame.
DROP_AREAS = {"NORTH-EASTERN ISLANDS", "SOUTHERN ISLANDS", "WESTERN ISLANDS"}

# HDB towns whose name is not identical to the URA planning area it comes from.
RENAME = {"KALLANG": "KALLANG/WHAMPOA"}

# Douglas-Peucker tolerance in degrees (~0.0003 deg ~= 33 m). Small enough that town
# outlines stay recognisable, large enough to shrink the file to well under ~200 KB.
SIMPLIFY_TOLERANCE = 0.0003
COORD_PRECISION = 5  # decimal places; ~1 m, plenty for a choropleth

# Drop detached polygon parts smaller than this (sq. degrees; ~1e-6 ~= 0.01 km2). These
# are tiny offshore specks — reclaimed dots off Changi Bay, Tuas jetties — that render as
# invisible pinpricks yet widen the map's frame (the Changi Bay pair pushes the east edge
# ~4.5 km out to sea, squeezing the mainland on narrow screens). Only ever trims parts of
# a MultiPolygon; single-polygon areas are always kept whole.
MIN_PART_AREA = 1e-6


def _get_json(url: str, timeout: int) -> dict:
    # data.gov.sg's S3 blobs 403 the default urllib user-agent; send a browser-like one.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (hdb-kaki build)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _fetch_dataset(dataset_id: str) -> dict:
    poll = f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download"
    url = _get_json(poll, 30)["data"]["url"]
    return _get_json(url, 60)


def _town_for(props: dict) -> str | None:
    """Return the HDB town a planning area belongs to, or None to drop it."""
    if props.get("CA_IND") == "Y":
        return "CENTRAL AREA"
    name = props["PLN_AREA_N"].strip().upper()
    return RENAME.get(name, name)


def _drop_specks(geom):
    """Drop tiny detached polygons from a (Multi)Polygon; return it otherwise unchanged.

    Single Polygons pass through untouched. For a MultiPolygon, parts below
    ``MIN_PART_AREA`` are removed (falling back to the largest if that would empty it),
    and a result left with one part collapses back to a plain Polygon.
    """
    if geom.geom_type != "MultiPolygon":
        return geom
    kept = [p for p in geom.geoms if p.area >= MIN_PART_AREA]
    if not kept:
        kept = [max(geom.geoms, key=lambda p: p.area)]
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


def _round(geom: dict, ndigits: int) -> dict:
    """Recursively round every coordinate in a GeoJSON geometry mapping."""

    def r(x):
        if isinstance(x, (int, float)):
            return round(x, ndigits)
        return [r(v) for v in x]

    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def build_towns() -> None:
    src = _fetch_dataset(DATASET_ID)

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
    # data and render as neutral "no data" grey. The offshore island groups are dropped.
    parts: dict[str, list] = {}
    others: list[tuple[str, object]] = []
    for f in src["features"]:
        props = f["properties"]
        town = _town_for(props)
        if town in valid:
            parts.setdefault(town, []).append(shape(f["geometry"]))
        elif props["PLN_AREA_N"].strip().upper() not in DROP_AREAS:
            others.append((props["PLN_AREA_N"].strip().upper(), shape(f["geometry"])))

    missing = valid - parts.keys()
    if missing:
        raise SystemExit(f"No planning-area geometry for towns: {sorted(missing)}")

    features = []
    all_geoms = []
    # HDB towns (dissolved) — hdb:true, keyed by town so overview.json medians join on.
    for town in sorted(parts):
        dissolved = _drop_specks(unary_union(parts[town]))
        all_geoms.append(dissolved)
        features.append({
            "type": "Feature",
            "properties": {"name": town, "hdb": True},
            "geometry": _round(mapping(dissolved.simplify(SIMPLIFY_TOLERANCE)), COORD_PRECISION),
        })
    # Non-HDB areas — hdb:false, drawn as no-data base geometry only.
    for name, geom in sorted(others):
        geom = _drop_specks(geom)
        all_geoms.append(geom)
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

    # Dissolve everything into one coastline-only polygon (internal town/area borders
    # removed) so the map can draw a crisp country outline as its own layer, distinct
    # from the lighter internal dividers.
    outline = unary_union(all_geoms).simplify(SIMPLIFY_TOLERANCE)
    outline_fc = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Singapore"},
            "geometry": _round(mapping(outline), COORD_PRECISION),
        }],
    }
    OUTLINE.write_text(json.dumps(outline_fc, separators=(",", ":")))
    print(f"Wrote {OUTLINE.relative_to(ROOT)} ({OUTLINE.stat().st_size / 1024:.1f} KB)")


def build_subzones() -> None:
    """Emit the ~330 URA subzones for the finer choropleth level.

    Keyed by SUBZONE_N (unique across all subzones), with the parent planning area kept
    for tooltip context. emit_web.py point-in-polygons transactions into these by name.
    The offshore island groups are dropped to match the town layer's mainland frame.
    """
    src = _fetch_dataset(SUBZONE_DATASET_ID)
    features = []
    for f in src["features"]:
        props = f["properties"]
        if props["PLN_AREA_N"].strip().upper() in DROP_AREAS:
            continue
        geom = _drop_specks(shape(f["geometry"]).simplify(SIMPLIFY_TOLERANCE))
        features.append({
            "type": "Feature",
            "properties": {
                "name": props["SUBZONE_N"].strip().upper(),
                "area": props["PLN_AREA_N"].strip().upper(),
            },
            "geometry": _round(mapping(geom), COORD_PRECISION),
        })

    fc = {"type": "FeatureCollection", "features": features}
    SUBZONES.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"Wrote {SUBZONES.relative_to(ROOT)} ({SUBZONES.stat().st_size / 1024:.1f} KB, "
          f"{len(features)} subzones)")


def build() -> None:
    GEO_DIR.mkdir(parents=True, exist_ok=True)
    build_towns()
    build_subzones()


if __name__ == "__main__":
    build()
