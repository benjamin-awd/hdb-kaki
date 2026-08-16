"""Canonical Singapore rail-station table for My Flat Insights' "walk to nearest MRT".

Two sources, merged into ``RAIL_STATIONS`` (one entry per physical station):

1. ``operational_coords.json`` — every station in revenue service today, geocoded from
   OneMap (the authoritative LTA source) by ``geocode_stations.py``. Refresh it with:

       uv run python webapp/update/geocode_stations.py

2. ``FUTURE_STATIONS`` (below) — every announced but not-yet-open station, hand-maintained
   because unbuilt stations cannot be geocoded. Coordinates are best-available planning
   locations from Wikipedia station infoboxes / LTA alignment maps. Each future-only station
   carries an ``opening`` (year, or a phrase like "TBA" when LTA has not committed a year);
   the frontend still ranks these as "nearest" but labels them so they aren't read as running.

Merge rules:
- Match is by station NAME. A future entry whose name already exists in the operational set
  is an existing station gaining a new line (e.g. Ang Mo Kio gains CR11): its new code is
  appended AFTER the operational code(s) — so the station keeps its operational coordinates,
  its operational line colour, and NO opening tag (it is already open).
- A future entry with a new name is a brand-new station: it uses its planning coordinates and
  its opening tag.

The two build scripts (build_mrt_stations.py, build_mrt_lines.py) both import RAIL_STATIONS,
so the station list and the drawn line geometry stay in lockstep.

Omitted deliberately (announced but with no confirmed name — a placeholder reads badly in the
"nearest MRT" card; add them here once LTA names them):
  - CRL Phase 3 working-code stations CR20 and CR22 (unnamed as of the 31 Jul 2026 announcement)
  - JRL infill station JS2A near Tengah (no published name or coordinate)
"""

from __future__ import annotations

import json
from pathlib import Path

_COORDS = Path(__file__).resolve().parent / "operational_coords.json"

# Line-code prefixes of not-yet-open lines. At an interchange these are ordered LAST so an
# existing station keeps its operational line's colour (the frontend colours by the first code):
# OneMap already tags e.g. Ang Mo Kio with the planned CR11, which must not out-sort NS16.
_FUTURE_PREFIXES = ("CR", "CP", "JS", "JW", "JE", "DE")


def _demote_future(codes: list[str]) -> list[str]:
    """Stable-sort codes so operational lines precede future ones, order otherwise preserved."""
    return sorted(codes, key=lambda c: 1 if c.startswith(_FUTURE_PREFIXES) else 0)


# Each entry: name, codes, lat, lng, opening. For a future entry that MERGES into an existing
# operational station (interchange), lat/lng/opening are None — the operational record supplies
# the coordinates and the station is already open, so it carries no opening tag.
FUTURE_STATIONS: list[dict] = [
    # ── Cross Island Line (CRL) — Phases 1-3, opening 2030 onward ────────────────────────────
    # New stations (planning coordinates, exact unless noted):
    {
        "name": "Aviation Park",
        "codes": "CR2",
        "lat": 1.37000,
        "lng": 104.00306,
        "opening": 2030,
    },
    {
        "name": "Loyang",
        "codes": "CR3",
        "lat": 1.37194,
        "lng": 103.97194,
        "opening": 2030,
    },
    {
        "name": "Pasir Ris East",
        "codes": "CR4",
        "lat": 1.36611,
        "lng": 103.96111,
        "opening": 2030,
    },
    {
        "name": "Tampines North",
        "codes": "CR6",
        "lat": 1.36917,
        "lng": 103.93778,
        "opening": 2030,
    },
    {"name": "Defu", "codes": "CR7", "lat": 1.36222, "lng": 103.89889, "opening": 2030},
    {
        "name": "Serangoon North",
        "codes": "CR9",
        "lat": 1.37056,
        "lng": 103.87361,
        "opening": 2030,
    },
    {
        "name": "Tavistock",
        "codes": "CR10",
        "lat": 1.37000,
        "lng": 103.86333,
        "opening": 2030,
    },
    {
        "name": "Teck Ghee",
        "codes": "CR12",
        "lat": 1.36556,
        "lng": 103.84361,
        "opening": 2030,
    },
    {
        "name": "Turf City",
        "codes": "CR14",
        "lat": 1.34083,
        "lng": 103.79444,
        "opening": 2032,
    },
    {
        "name": "Maju",
        "codes": "CR16",
        "lat": 1.32833,
        "lng": 103.77694,
        "opening": 2032,
    },
    {
        "name": "West Coast",
        "codes": "CR18",
        "lat": 1.31083,
        "lng": 103.75778,
        "opening": 2032,
    },
    {
        "name": "Jurong Lake District",
        "codes": "CR19",
        "lat": 1.32722,
        "lng": 103.73917,
        "opening": 2032,
    },
    # Changi Terminal 5: CRL terminus + TEL extension, one physical station (mid-2030s).
    {
        "name": "Changi Terminal 5",
        "codes": "CR1 / TE32",
        "lat": 1.32444,
        "lng": 103.99278,
        "opening": "mid-2030s",
    },
    # Jurong Pier: CRL Phase 3 + JRL, first opens with the JRL platform (2029).
    {
        "name": "Jurong Pier",
        "codes": "JS12 / CR21",
        "lat": 1.31306,
        "lng": 103.71028,
        "opening": 2029,
    },
    # CRL interchanges with existing stations (code appended, no new coords / opening):
    {
        "name": "Pasir Ris",
        "codes": "CR5 / CP1",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + EW1
    {
        "name": "Hougang",
        "codes": "CR8",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + NE14
    {
        "name": "Ang Mo Kio",
        "codes": "CR11",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + NS16
    {
        "name": "Bright Hill",
        "codes": "CR13",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + TE7
    {
        "name": "King Albert Park",
        "codes": "CR15",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + DT6
    {
        "name": "Clementi",
        "codes": "CR17",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + EW23
    {
        "name": "Gul Circle",
        "codes": "CR23",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + EW30
    # ── CRL Punggol Extension (CP), opening 2032 ─────────────────────────────────────────────
    {
        "name": "Elias",
        "codes": "CP2",
        "lat": 1.38389,
        "lng": 103.93806,
        "opening": 2032,
    },
    {
        "name": "Riviera",
        "codes": "CP3",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + PE4 (Punggol LRT)
    {
        "name": "Punggol",
        "codes": "CP4",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + NE17
    # ── Jurong Region Line (JRL), opening 2028-2029 ──────────────────────────────────────────
    {
        "name": "Choa Chu Kang West",
        "codes": "JS2",
        "lat": 1.37889,
        "lng": 103.73944,
        "opening": 2028,
    },
    {
        "name": "Tengah",
        "codes": "JS3",
        "lat": 1.36639,
        "lng": 103.73000,
        "opening": 2028,
    },
    {
        "name": "Hong Kah",
        "codes": "JS4",
        "lat": 1.35806,
        "lng": 103.72583,
        "opening": 2028,
    },
    {
        "name": "Corporation",
        "codes": "JS5",
        "lat": 1.35306,
        "lng": 103.71389,
        "opening": 2028,
    },
    {
        "name": "Jurong West",
        "codes": "JS6",
        "lat": 1.34917,
        "lng": 103.70833,
        "opening": 2028,
    },
    {
        "name": "Bahar Junction",
        "codes": "JS7",
        "lat": 1.34542,
        "lng": 103.70254,
        "opening": 2028,
    },
    {
        "name": "Enterprise",
        "codes": "JS9",
        "lat": 1.33278,
        "lng": 103.70861,
        "opening": 2029,
    },
    {
        "name": "Tukang",
        "codes": "JS10",
        "lat": 1.32528,
        "lng": 103.70917,
        "opening": 2029,
    },
    {
        "name": "Jurong Hill",
        "codes": "JS11",
        "lat": 1.31861,
        "lng": 103.71028,
        "opening": 2029,
    },
    {
        "name": "Gek Poh",
        "codes": "JW1",
        "lat": 1.34833,
        "lng": 103.69806,
        "opening": 2028,
    },
    {
        "name": "Tawas",
        "codes": "JW2",
        "lat": 1.35056,
        "lng": 103.69194,
        "opening": 2028,
    },
    {
        "name": "Nanyang Gateway",
        "codes": "JW3",
        "lat": 1.35361,
        "lng": 103.68667,
        "opening": 2029,
    },
    {
        "name": "Nanyang Crescent",
        "codes": "JW4",
        "lat": 1.34833,
        "lng": 103.68083,
        "opening": 2029,
    },
    {
        "name": "Peng Kang Hill",
        "codes": "JW5",
        "lat": 1.34333,
        "lng": 103.67861,
        "opening": 2029,
    },
    {
        "name": "Tengah Plantation",
        "codes": "JE1",
        "lat": 1.35722,
        "lng": 103.73333,
        "opening": 2028,
    },
    {
        "name": "Tengah Park",
        "codes": "JE2",
        "lat": 1.35222,
        "lng": 103.73667,
        "opening": 2028,
    },
    {
        "name": "Bukit Batok West",
        "codes": "JE3",
        "lat": 1.34556,
        "lng": 103.73972,
        "opening": 2028,
    },
    {
        "name": "Toh Guan",
        "codes": "JE4",
        "lat": 1.33972,
        "lng": 103.74250,
        "opening": 2028,
    },
    {
        "name": "Jurong Town Hall",
        "codes": "JE6",
        "lat": 1.32611,
        "lng": 103.74611,
        "opening": 2028,
    },
    {
        "name": "Pandan Reservoir",
        "codes": "JE7",
        "lat": 1.32000,
        "lng": 103.74500,
        "opening": 2028,
    },
    # JRL interchanges with existing stations:
    {
        "name": "Choa Chu Kang",
        "codes": "JS1",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + NS4 / BP1
    {
        "name": "Boon Lay",
        "codes": "JS8",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + EW27
    {
        "name": "Jurong East",
        "codes": "JE5",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + NS1 / EW24
    # ── Circle Line Stage 6 (CCL6) — loop closure, opening 2026 ──────────────────────────────
    {
        "name": "Keppel",
        "codes": "CC30",
        "lat": 1.27000,
        "lng": 103.83111,
        "opening": 2026,
    },
    {
        "name": "Cantonment",
        "codes": "CC31",
        "lat": 1.27278,
        "lng": 103.83667,
        "opening": 2026,
    },
    {
        "name": "Prince Edward Road",
        "codes": "CC32",
        "lat": 1.27333,
        "lng": 103.84722,
        "opening": 2026,
    },
    {
        "name": "Marina Bay",
        "codes": "CC33",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + NS27 / TE20 / CE2
    {
        "name": "Bayfront",
        "codes": "CC34",
        "lat": None,
        "lng": None,
        "opening": None,
    },  # + CE1 / DT16
    # ── Thomson-East Coast Line — remaining stations ─────────────────────────────────────────
    {
        "name": "Mount Pleasant",
        "codes": "TE10",
        "lat": 1.32861,
        "lng": 103.83556,
        "opening": "TBA",
    },
    {
        "name": "Founders' Memorial",
        "codes": "TE22A",
        "lat": 1.29083,
        "lng": 103.86917,
        "opening": 2028,
    },
    {
        "name": "Bedok South",
        "codes": "TE30",
        "lat": 1.31667,
        "lng": 103.94833,
        "opening": 2026,
    },
    # Sungei Bedok: TEL Stage 5 terminus + Downtown Line 3 extension terminus, one station.
    {
        "name": "Sungei Bedok",
        "codes": "TE31 / DT37",
        "lat": 1.32028,
        "lng": 103.95694,
        "opening": 2026,
    },
    # ── Downtown Line 3 Extension (DTL3e), opening 2026 ──────────────────────────────────────
    {
        "name": "Xilin",
        "codes": "DT36",
        "lat": 1.32889,
        "lng": 103.96500,
        "opening": 2026,
    },
    # ── North-South Line infill ──────────────────────────────────────────────────────────────
    {
        "name": "Brickland",
        "codes": "NS3A",
        "lat": 1.36861,
        "lng": 103.74944,
        "opening": 2034,
    },
    # Sungei Kadut: long-reserved NSL code NS6 + future Downtown Line western terminus DE2.
    {
        "name": "Sungei Kadut",
        "codes": "NS6 / DE2",
        "lat": 1.41333,
        "lng": 103.74889,
        "opening": 2035,
    },
]


def _merge() -> list[dict]:
    ops = json.loads(_COORDS.read_text())
    out: dict[str, dict] = {
        name: {
            "name": name,
            "codes": [c.strip() for c in v["codes"].split("/")],
            "lat": v["lat"],
            "lng": v["lng"],
            "opening": None,
        }
        for name, v in ops.items()
    }

    for f in FUTURE_STATIONS:
        fcodes = [c.strip() for c in f["codes"].split("/")]
        if f["name"] in out:
            # Existing station gaining a line: append the new code(s) after the operational
            # ones so it keeps its operational coordinates, colour and (absent) opening tag.
            e = out[f["name"]]
            for c in fcodes:
                if c not in e["codes"]:
                    e["codes"].append(c)
        else:
            if f["lat"] is None or f["lng"] is None:
                raise ValueError(
                    f"{f['name']}: no operational match, so planning coordinates are required"
                )
            out[f["name"]] = {
                "name": f["name"],
                "codes": fcodes,
                "lat": f["lat"],
                "lng": f["lng"],
                "opening": f["opening"],
            }

    stations = []
    for e in out.values():
        entry = {
            "name": e["name"],
            "codes": " / ".join(_demote_future(e["codes"])),
            "lat": e["lat"],
            "lng": e["lng"],
        }
        if e["opening"] is not None:
            entry["opening"] = e["opening"]
        stations.append(entry)
    return stations


RAIL_STATIONS: list[dict] = _merge()
