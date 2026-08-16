"""Build the nearby-amenities list shown on My Flat Insights' map.

Emits a compact, committed ``web/public/geo/amenities.json`` — one entry per amenity, tagged
with a coarse category the page filters and icons by:

    [{"type": "hawker", "name": "Chomp Chomp Food Centre", "lat": 1.3644, "lng": 103.8571}, ...]

Categories and sources:
  - ``hawker``      — food & drink: NEA Hawker Centres (official data.gov.sg GeoJSON) plus OSM
                      food courts and cafes. Bare placeholder names ("Food Court") are dropped.
  - ``supermarket`` — OpenStreetMap (shop=supermarket): data.gov.sg's supermarket listing is
                      tabular (no coordinates), so OSM is used for point geometry.
  - ``mall``        — OpenStreetMap (shop=mall): no official data.gov.sg mall dataset exists.

OSM data is ODbL (attribution required). Amenities change slowly, so the output is committed and
this runs on demand, not in the daily ETL:

    uv run python webapp/update/build_amenities.py
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

# Drop OSM entries whose name is only a generic placeholder (optionally + a number), e.g.
# "Food Court", "Canteen 14", "Coffee Shop", "Cafe". Location-bearing names ("Coffee Shop @
# Blk 134", "183 Food Court", "OLLA Specialty Coffee") are kept.
_GENERIC = re.compile(
    r"^(food ?court|food ?centre|coffee ?shop|kopitiam|canteen|foodcourt|"
    r"hawker ?cent(er|re)|market|cafe|cafeteria|eating house)\s*\d*$",
    re.I,
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "geo" / "amenities.json"

UA = {"User-Agent": "Mozilla/5.0 (hdb-kaki build)"}
HAWKER_DATASET = "d_4a086da0a5553be1d89383cd90d07ecd"  # NEA Hawker Centres (GeoJSON)
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
BBOX = "1.15,103.55,1.48,104.1"  # Singapore


def _get(url: str, timeout: int = 90) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def _hawkers() -> list[dict]:
    """NEA hawker centres from data.gov.sg — poll for a signed URL, then fetch the GeoJSON."""
    meta = json.loads(
        _get(f"https://api-open.data.gov.sg/v1/public/api/datasets/{HAWKER_DATASET}/poll-download")
    )
    gj = json.loads(_get(meta["data"]["url"]))
    out = []
    for f in gj.get("features", []):
        p = f.get("properties", {})
        name = (p.get("NAME") or "").strip()
        lng, lat = (f.get("geometry") or {}).get("coordinates", [None, None])[:2]
        if name and lat is not None and lng is not None:
            out.append({"type": "hawker", "name": name, "lat": round(lat, 5), "lng": round(lng, 5)})
    return out


def _overpass(query: str) -> list[dict]:
    """Run an Overpass query, trying mirrors in turn (they 429/504 under load)."""
    data = urllib.parse.urlencode({"data": query}).encode()
    # overpass-api.de 406s a generic "Mozilla" UA; use a descriptive one + explicit form type.
    headers = {
        "User-Agent": "hdb-kaki/1.0 (https://github.com/benjamin-awd/hdb-kaki)",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    last: Exception | None = None
    for mirror in OVERPASS_MIRRORS:
        try:
            req = urllib.request.Request(mirror, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r).get("elements", [])
        except Exception as e:  # noqa: BLE001 — try the next mirror on any failure
            last = e
            print(f"  overpass {mirror} failed ({e}); trying next mirror")
    raise RuntimeError(f"all Overpass mirrors failed: {last}")


def _osm_amenities() -> list[dict]:
    """One combined Overpass query for supermarkets, malls, and food courts (fewer flaky calls).
    Food courts join the hawker category so coffeeshops/food centres (e.g. "Food Loft @10") show;
    OSM tags these inconsistently, so coverage is partial and generic restaurants are excluded."""
    q = (
        f"[out:json][timeout:120];("
        f'nwr["shop"="supermarket"]({BBOX});'
        f'nwr["shop"="mall"]({BBOX});'
        f'nwr["amenity"="food_court"]({BBOX});'
        f'nwr["amenity"="cafe"]({BBOX});'
        f");out center tags;"
    )
    out = []
    for el in _overpass(q):
        tags = el.get("tags", {})
        if tags.get("shop") == "supermarket":
            cat = "supermarket"
        elif tags.get("shop") == "mall":
            cat = "mall"
        elif tags.get("amenity") in ("food_court", "cafe"):
            cat = "hawker"  # food courts + cafes join the food/drink layer
        else:
            continue
        name = (tags.get("name") or "").strip()
        center = el.get("center") or {}
        lat = el.get("lat") or center.get("lat")  # SG coords never 0, so `or` is safe
        lng = el.get("lon") or center.get("lon")
        if name and not _GENERIC.match(name) and lat is not None and lng is not None:
            out.append({"type": cat, "name": name, "lat": round(lat, 5), "lng": round(lng, 5)})
    return out


def build() -> None:
    rows = _hawkers() + _osm_amenities()

    seen: set[tuple] = set()
    amenities = []
    for a in sorted(rows, key=lambda a: (a["type"], a["name"])):
        key = (a["type"], a["name"], round(a["lat"], 4), round(a["lng"], 4))
        if key not in seen:
            seen.add(key)
            amenities.append(a)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(amenities, separators=(",", ":")))
    counts = {c: sum(a["type"] == c for a in amenities) for c in ("hawker", "supermarket", "mall")}
    print(
        f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB, "
        f"{len(amenities)} amenities: {counts})"
    )


if __name__ == "__main__":
    build()
