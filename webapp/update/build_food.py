"""Build the food & drink layer for My Flat Insights.

SFA licenses every food outlet in Singapore, so its Track Records API is the one comprehensive,
current, correctly-named source (OpenStreetMap misses many; the data.gov.sg dump is a stale 2024
snapshot). This scrapes it ONCE at build time — so no user location ever leaves the browser at
runtime — keeps consumer venue-level food types, uses the trade ``businessName``, geocodes each
unique postal via OneMap Search (authenticated: the account's 250/min quota is a reliable bucket
the anonymous per-IP throttle is not), and merges in NEA hawker centres. Postal->coords are cached
in ``postal_coords.json`` so refreshes only geocode new postals. Needs ONEMAP_EMAIL/ONEMAP_PASSWORD
(env or ``web/.dev.vars``). Emits a committed ``web/public/geo/food.json``:

    [{"name": "Grounds on a Hill", "lat": 1.30806, "lng": 103.77419},
     {"name": "5 Star Dim Sum", "lat": ..., "lng": ..., "n": 9, "names": [...]}, ...]

Coffeeshop stalls collapse into their parent venue, and food inside a mall is dropped (the Mall
pin already represents it; mall postals are matched against the mall names in ``amenities.json``).
Since we geocode by postal, eateries sharing a block are compiled into one pin, carrying a count
and a capped name list for the tooltip.

Run on demand (a few minutes; re-run to refresh):

    uv run python webapp/update/build_food.py

Caveat: SFA's ``businessName`` is the trade name for most outlets but occasionally a franchisee's
company name (e.g. "APPS GURU" for a Springleaf Prata outlet). Sources: SFA + NEA (data.gov.sg).
"""

from __future__ import annotations

import gzip
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "geo" / "food.json"
# Committed postal -> [lat, lng] cache. Postals never move, so a scheduled refresh only geocodes
# newly-seen postals and this stays a fast, near-instant no-op run to run.
CACHE = ROOT / "webapp" / "update" / "postal_coords.json"
UA = {"User-Agent": "Mozilla/5.0 (hdb-kaki build)"}
HAWKER_DATASET = "d_4a086da0a5553be1d89383cd90d07ecd"  # NEA Hawker Centres (GeoJSON)

# SFA has no parent/child field, so we classify by establishment type and collapse per premises
# (postal): a coffeeshop/foodcourt shell + its stalls become ONE pin named after the parent, while
# standalone eateries (their own shopfront) each stay a distinct pin even when they share a postal.
#
# PARENT — the coffeeshop/foodcourt operator itself; the pin we keep when stalls collapse into it.
PARENT_TYPES = {"Coffeeshop/Eating House", "Foodcourt", "Food Court"}
# STALL — an individual stall inside a coffeeshop/foodcourt. SFA reuses this one long type for both
# stalls and (occasionally) the operator, so we treat it as a stall only when a PARENT shares its
# postal; otherwise it stands alone (an un-captured foodcourt).
STALL_TYPE = "Coffeeshop/Eating house/Canteen/Foodcourt/Canteen within tertiary institution"
# STANDALONE — its own shopfront; always kept individually. Excludes NEA foodstalls, "within a
# coffeeshop" stalls, canteens, caterers, cloud/central kitchens, manufacturing, cold stores,
# markets, supermarkets and vending machines.
STANDALONE_TYPES = {
    "Restaurant",
    "Small restaurant",
    "Restaurant with Catering",
    "Snack Counter",
    "Bakery",
    "Takeaway",
}
KEEP_TYPES = PARENT_TYPES | STANDALONE_TYPES | {STALL_TYPE}
_POSTAL = re.compile(r"Singapore (\d{6})", re.I)
_BAD_NAME = {"", "NA", "NIL", "NULL", "-", "N.A.", "NA.", "."}
# Generic stall descriptors (not real trade names) — a real eatery is essentially never named
# exactly one of these. Exact-match only, so brandy names ("Mixed Rice King") are untouched.
_GENERIC_NAME = {
    "beverages", "beverage", "drinks", "drink stall", "drinks stall", "beverage stall",
    "mixed rice", "economic rice", "economy rice", "economic bee hoon", "cooked food",
    "food stall", "foodstall", "dessert", "desserts", "noodles", "public traders",
}


def _get(url: str, timeout: int = 120) -> bytes:
    raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
    try:
        return gzip.decompress(raw)
    except (OSError, EOFError):
        return raw


def _tidy(name: str) -> str:
    """Single-case names (ALL CAPS or all lowercase) read as sloppy; title-case those. Names SFA
    already stored with intentional mixed case ("Grounds on a Hill", "OLLA") are left as-is."""
    letters = [c for c in name if c.isalpha()]
    if letters and (name == name.upper() or name == name.lower()):
        return name.title()
    return name


def _mall_postals(records: list[dict]) -> set[str]:
    """Postals that belong to a mall, so we can drop food inside them (the Mall pin already stands
    for it). Detected by matching a full comma-delimited component of the SFA address against the
    mall names we actually plot (amenities.json) — so hiding stays consistent with what's shown."""
    amenities = ROOT / "web" / "public" / "geo" / "amenities.json"
    if not amenities.exists():
        return set()
    norm = lambda s: re.sub(r"\s+", " ", s.strip().lower())
    names = {
        norm(a["name"])
        for a in json.loads(amenities.read_text())
        if a.get("type") == "mall" and len(a["name"]) >= 5 and not a["name"].isdigit()
    }
    postals: set[str] = set()
    for r in records:
        addr = r.get("establishmentAddress", "")
        if any(norm(part) in names for part in addr.split(",")):
            m = _POSTAL.search(addr)
            if m:
                postals.add(m.group(1))
    return postals


def _sfa_rows() -> tuple[list[dict], set[str]]:
    """One call returns every establishment (address always contains 'Singapore')."""
    q = {
        "postalCode": "",
        "establishmentAddress": "Singapore",
        "licenceNumber": "",
        "businessName": "",
        "licenseeName": "",
        "typeOfFoodBussiness": "",
        "isShowLicenceSuspended": "false",
        "grades": "",
    }
    url = "https://www.sfa.gov.sg/api/TrackRecord/GetTrackRecord?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(
        url, headers={**UA, "Accept": "application/json", "X-Requested-With": "XMLHttpRequest"}
    )
    raw = urllib.request.urlopen(req, timeout=120).read()
    try:
        raw = gzip.decompress(raw)
    except (OSError, EOFError):
        pass
    data = json.loads(raw)
    records = data if isinstance(data, list) else next(
        (v for v in data.values() if isinstance(v, list)), []
    )

    mall_postals = _mall_postals(records)  # food inside a mall is covered by the Mall pin — drop it

    # Pass 1: collect keepable rows, and note which postals host a coffeeshop/foodcourt parent.
    kept, parent_postals = [], set()
    for r in records:
        ftype = r.get("typeOfFoodBussiness")
        if ftype not in KEEP_TYPES:
            continue
        name = (r.get("businessName") or "").strip()
        if name.upper() in _BAD_NAME or name.lower() in _GENERIC_NAME:
            continue
        m = _POSTAL.search(r.get("establishmentAddress", ""))
        if not m or m.group(1) in mall_postals:
            continue
        kept.append({"name": name, "postal": m.group(1), "type": ftype})
        if ftype in PARENT_TYPES:
            parent_postals.add(m.group(1))

    # Pass 2: at a postal with a parent, drop the stall rows (they collapse into the parent pin);
    # standalone eateries and orphan stalls (no parent at their postal) are kept as their own pins.
    rows, postals = [], set()
    seen: set[tuple] = set()
    for r in kept:
        if r["type"] == STALL_TYPE and r["postal"] in parent_postals:
            continue
        key = (r["name"].lower(), r["postal"])  # collapse multi-unit / multi-licence duplicates
        if key in seen:
            continue
        seen.add(key)
        rows.append({"name": _tidy(r["name"]), "postal": r["postal"]})
        postals.add(r["postal"])
    return rows, postals


def _onemap_token() -> str:
    """Mint a OneMap token from ONEMAP_EMAIL/ONEMAP_PASSWORD (env, or web/.dev.vars for local
    builds). Authenticated Search uses the account's 250/min quota — a separate, reliable bucket
    that the anonymous per-IP throttle does not, so geocoding succeeds where anon requests get
    dropped. In CI, provide the two values as secrets."""
    email, password = os.environ.get("ONEMAP_EMAIL"), os.environ.get("ONEMAP_PASSWORD")
    dev = ROOT / "web" / ".dev.vars"
    if not (email and password) and dev.exists():
        vals = dict(
            line.split("=", 1)
            for line in dev.read_text().splitlines()
            if "=" in line and not line.lstrip().startswith("#")
        )
        email = email or vals.get("ONEMAP_EMAIL", "").strip()
        password = password or vals.get("ONEMAP_PASSWORD", "").strip()
    if not (email and password):
        raise SystemExit("Set ONEMAP_EMAIL / ONEMAP_PASSWORD (or web/.dev.vars) to geocode.")
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        "https://www.onemap.gov.sg/api/auth/post/getToken",
        data=body,
        headers={"content-type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=30))["access_token"]


def _geocode_all(postals: set[str], token: str) -> dict[str, tuple[float, float]]:
    """Postal -> (lat, lng) via authenticated OneMap Search, paced under the 250/min quota. Results
    persist in CACHE, so only newly-seen postals are looked up (near-instant on repeat runs)."""
    cache: dict[str, list] = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [p for p in postals if p not in cache]
    print(f"  geocoding {len(todo)} new postals ({len(postals) - len(todo)} cached)", flush=True)

    for i, postal in enumerate(todo, 1):
        url = (
            "https://www.onemap.gov.sg/api/common/elastic/search"
            f"?searchVal={postal}&returnGeom=Y&getAddrDetails=N&pageNum=1"
        )
        for attempt in range(3):  # retry transient network errors only; auth makes hits reliable
            try:
                req = urllib.request.Request(url, headers={**UA, "Authorization": token})
                res = json.load(urllib.request.urlopen(req, timeout=20)).get("results") or []
                if res:
                    cache[postal] = [round(float(res[0]["LATITUDE"]), 5), round(float(res[0]["LONGITUDE"]), 5)]
                break
            except Exception:
                time.sleep(0.5 * (attempt + 1))
        time.sleep(0.26)  # ~3.8 req/s, safely under OneMap's 250/min
        if i % 250 == 0:
            print(f"    {i}/{len(todo)} ({sum(p in cache for p in todo)} ok)", flush=True)
            CACHE.write_text(json.dumps(cache, separators=(",", ":")))  # checkpoint

    CACHE.write_text(json.dumps(dict(sorted(cache.items())), separators=(",", ":")))
    return {p: tuple(cache[p]) for p in postals if p in cache}


def _hawker_centres() -> list[dict]:
    meta = json.loads(
        _get(f"https://api-open.data.gov.sg/v1/public/api/datasets/{HAWKER_DATASET}/poll-download")
    )
    gj = json.loads(_get(meta["data"]["url"]))
    out = []
    for f in gj.get("features", []):
        name = (f.get("properties", {}).get("NAME") or "").strip()
        lng, lat = (f.get("geometry") or {}).get("coordinates", [None, None])[:2]
        if name and lat is not None and lng is not None:
            out.append({"name": name, "lat": round(lat, 5), "lng": round(lng, 5)})
    return out


def build() -> None:
    rows, postals = _sfa_rows()
    print(f"SFA venue-level food: {len(rows)} rows, {len(postals)} unique postals", flush=True)
    coords = _geocode_all(postals, _onemap_token())
    print(f"geocoded {len(coords)}/{len(postals)} postals", flush=True)

    # One pin per point (== per postal, since we geocode by postal): every eatery at a block is
    # coincident, so compile them into a single marker. Each entry keeps the count and a capped,
    # de-duplicated name list for the tooltip ("what's here"): {name, lat, lng, n, names}.
    NAME_CAP = 8
    groups: dict[tuple, dict] = {}

    def _add(pt: tuple, name: str) -> None:
        g = groups.setdefault(pt, {"names": [], "seen": set()})
        if name.lower() not in g["seen"]:
            g["seen"].add(name.lower())
            g["names"].append(name)

    for r in rows:
        if r["postal"] in coords:
            _add(coords[r["postal"]], r["name"])
    for h in _hawker_centres():  # already one point each with a unique name
        _add((h["lat"], h["lng"]), h["name"])

    out = []
    for (lat, lng), g in groups.items():
        names = sorted(g["names"], key=str.lower)
        entry = {"name": names[0], "lat": lat, "lng": lng, "n": len(names)}
        if len(names) > 1:
            entry["names"] = names[:NAME_CAP]  # capped list for the tooltip
        out.append(entry)
    out.sort(key=lambda a: a["name"].lower())

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB, {len(out)} pins)")


if __name__ == "__main__":
    build()
