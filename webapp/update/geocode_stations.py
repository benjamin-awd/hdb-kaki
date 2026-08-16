"""Refresh ``operational_coords.json`` — the coordinates of every in-service MRT/LRT station.

Queries OneMap's public search API (the authoritative LTA source; no API token needed for
search) once per physical station and records each line code's point:

    {"Outram Park": {"codes": "EW16 / NE3 / TE17", "lat": 1.28082, "lng": 103.83920}, ...}

OneMap returns one result per line code ("OUTRAM PARK MRT STATION (EW16)", "(NE3)", "(TE17)"),
so interchanges fall out naturally — codes are merged and the points averaged to one centre.

The station list to refresh is the union of the names already in operational_coords.json and
EXTRA_NAMES below (add a newly-opened station's name to EXTRA_NAMES once, then it is cached).
Announced-but-unopened stations are NOT geocoded here — they live in rail_stations.FUTURE_STATIONS.

    uv run python webapp/update/geocode_stations.py

Stations change rarely, so the output is committed and this runs on demand, not in the daily ETL.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent / "operational_coords.json"

# Stations that opened after this cache was first built. Listed so a from-scratch refresh still
# discovers them; harmless once they are in the committed cache.
EXTRA_NAMES: set[str] = {
    # Thomson-East Coast Line build-out
    "Springleaf",
    "Lentor",
    "Mayflower",
    "Bright Hill",
    "Upper Thomson",
    "Napier",
    "Orchard Boulevard",
    "Great World",
    "Havelock",
    "Maxwell",
    "Shenton Way",
    "Marina South",
    "Gardens by the Bay",
    "Tanjong Rhu",
    "Katong Park",
    "Tanjong Katong",
    "Marine Parade",
    "Marine Terrace",
    "Siglap",
    "Bayshore",
    "Hume",  # Downtown Line
    "Punggol Coast",  # North East Line
}

# Codes inside the trailing parens, e.g. "(NS4 / BP1)" or the numberless LRT hubs "(PTC)"/"(STC)".
_CODE = r"[A-Z]{2,4}\d*[A-Z]?"
_CODE_RE = re.compile(rf"\(({_CODE}(?:\s*/\s*{_CODE})*)\)")


def _search(q: str, tries: int = 5) -> dict:
    url = (
        "https://www.onemap.gov.sg/api/common/elastic/search?"
        + urllib.parse.urlencode(
            {"searchVal": q, "returnGeom": "Y", "getAddrDetails": "N", "pageNum": 1}
        )
    )
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (hdb-kaki build)"}
    )
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.load(r)
        except (
            Exception
        ) as e:  # noqa: BLE001 — transient 429s / timeouts, just back off
            wait = 2 * (i + 1)
            print(f"  retry {q!r} ({e}) in {wait}s", flush=True)
            time.sleep(wait)
    return {"results": []}


def _geocode(name: str) -> dict | None:
    """Return {"codes", "lat", "lng"} for a station name, or None if OneMap has no match."""
    d = _search(f"{name} MRT STATION")
    up = name.upper()
    seen: dict[str, tuple[float, float]] = {}
    for r in d.get("results", []):
        sv = r["SEARCHVAL"].upper()
        if "EXIT" in sv:
            continue
        base = re.sub(r"\s*\(.*?\)\s*$", "", sv).strip()
        if base not in (f"{up} MRT STATION", f"{up} LRT STATION"):
            continue
        m = _CODE_RE.search(sv)
        if not m:
            continue
        for c in re.split(r"\s*/\s*", m.group(1)):
            seen.setdefault(c, (float(r["LATITUDE"]), float(r["LONGITUDE"])))
    if not seen:
        return None
    lat = sum(v[0] for v in seen.values()) / len(seen)
    lng = sum(v[1] for v in seen.values()) / len(seen)
    return {
        "codes": " / ".join(sorted(seen)),
        "lat": round(lat, 5),
        "lng": round(lng, 5),
    }


def build() -> None:
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    names = sorted(set(old) | EXTRA_NAMES)

    out: dict[str, dict] = {}
    misses = []
    for n in names:
        hit = _geocode(n)
        if hit:
            if n in old:
                # Union with the known codes so a query that fails to surface a station's LRT
                # sibling (e.g. Bukit Panjang's BP6) never silently drops it. Coordinates are
                # taken fresh from OneMap.
                hit["codes"] = " / ".join(
                    sorted(
                        set(hit["codes"].split(" / "))
                        | set(old[n]["codes"].split(" / "))
                    )
                )
            out[n] = hit
        elif n in old:
            out[n] = old[
                n
            ]  # OneMap miss (e.g. closed station) — keep the last-known coords
            print(f"FB  {n} (kept cached coords)", flush=True)
        else:
            misses.append(n)
            print(f"MISS {n} (no OneMap result, no cache)", flush=True)
        time.sleep(0.6)

    OUT.write_text(json.dumps(out, indent=1, sort_keys=True))
    print(
        f"\nWrote {OUT.name} ({len(out)} stations)"
        + (f", {len(misses)} unresolved: {misses}" if misses else "")
    )


if __name__ == "__main__":
    build()
