"""Emit web artifacts for the static frontend (see wireframes/REBUILD_PLAN.md).

Reads the combined ``data/df.parquet`` (produced by ``convert.csv_to_parquet``) and
writes a single ZSTD-compressed, column-trimmed ``resale.parquet`` into
``web/public/data/`` along with a ``manifest.json``. Standalone (polars only) so it
does not depend on the Streamlit-Cloud path baked into ``webapp.utils.get_project_root``.

The data is emitted as ONE file rather than year-shards: DuckDB-WASM reads it over HTTP
range requests, and every query spans all years, so sharding only multiplied the
sequential round-trips (footer + column reads per file) with no pruning benefit. A
single file is read in one pass — far fewer requests, much faster first query.

Also precomputes ``overview.json`` (landing page) and ``town-analysis.json`` (the
town-analysis default view) so those pages paint from a single small fetch instead of
booting DuckDB-WASM in the browser on load. The queries here mirror the SQL in the
corresponding page one-for-one so the numbers stay identical; DuckDB is only booted
in the browser when the visitor changes a filter.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parents[2]
SRC_PARQUET = ROOT / "data" / "df.parquet"
METADATA = ROOT / "data" / "metadata"
OUT_DIR = ROOT / "web" / "public" / "data"
GEO_DIR = (
    ROOT / "web" / "public" / "geo"
)  # committed boundary assets (build_town_geojson.py)

# Default view the town-analysis page renders on load. MUST match the DEFAULT_TOWN /
# DEFAULT_FLAT constants in web/src/pages/town-analysis.astro.
TA_DEFAULT_TOWN = "ANG MO KIO"
TA_DEFAULT_FLAT = "4 ROOM"

# Default view psf-trends renders on load. MUST match DEFAULT_TOWN / START / SCATTER_CAP
# in web/src/pages/psf-trends.astro.
PSF_DEFAULT_TOWN = "ANG MO KIO"
PSF_START = "2020-01"
PSF_SCATTER_CAP = 6000

# Rows per page of the landing recent-transactions table. MUST match PAGE_SIZE in
# web/src/pages/index.astro so the snapshot's first page lines up with the paged query.
RECENT_PAGE_SIZE = 20

# Columns dropped for the web: derivable or unused by any page.
#   _id, _ts        — internal ETL bookkeeping
#   remaining_lease — string form; kept as remaining_lease_years
#   block           — redundant; address already begins with the block
DROP_COLS = ["_id", "_ts", "remaining_lease", "block"]


def _subzone_medians(df: pl.DataFrame, cutoff: str) -> list[dict]:
    """Median 4-room price per URA subzone, for the finer choropleth level.

    The resale ``town`` field is only town-level, but each sale carries lat/lon, so we
    point-in-polygon transactions into web/public/geo/sg-subzones.geojson (built by
    build_town_geojson.py) and aggregate by subzone. Same 12-month, 4-room slice as the
    town map so switching levels is a true zoom-in. n is kept so the map can grey out
    subzones with too few sales to rank.
    """
    # shapely is only needed for this block; imported lazily so the rest of the emitter
    # stays polars-only. The deploy workflow installs it alongside polars.
    import statistics
    from collections import defaultdict

    from shapely import STRtree
    from shapely.geometry import Point, shape

    geo = json.loads((GEO_DIR / "sg-subzones.geojson").read_text())
    polys = [shape(f["geometry"]) for f in geo["features"]]
    names = [f["properties"]["name"] for f in geo["features"]]
    tree = STRtree(polys)

    d = df.filter(
        (pl.col("flat_type") == "4 ROOM")
        & (pl.col("month") >= cutoff)
        & pl.col("latitude").is_not_null()
    ).select("latitude", "longitude", "resale_price")
    lat = d["latitude"].to_list()
    lng = d["longitude"].to_list()
    price = d["resale_price"].to_list()

    buckets: dict[str, list[float]] = defaultdict(list)
    for la, lo, pr in zip(lat, lng, price):
        hit = tree.query(Point(lo, la), predicate="within")
        if len(hit):
            buckets[names[hit[0]]].append(pr)

    return sorted(
        (
            {"sz": sz, "med": statistics.median(v), "n": len(v)}
            for sz, v in buckets.items()
        ),
        key=lambda r: r["sz"],
    )


def _quarter_expr() -> pl.Expr:
    """'YYYY-MM' -> 'YYYY Qn'. Mirrors the quarterExpr string in index.astro."""
    year = pl.col("month").str.slice(0, 4)
    mm = pl.col("month").str.slice(5, 2).cast(pl.Int32)
    quarter = ((mm - 1) // 3 + 1).cast(pl.Utf8)
    return (year + pl.lit(" Q") + quarter).alias("quarter")


def emit_overview(df: pl.DataFrame) -> None:
    """Precompute the four landing-page charts + recent table into overview.json.

    Each block mirrors the corresponding query in web/src/pages/index.astro. The
    12-month window uses today's date (recomputed each ETL run), matching the app's
    original ``current_date - INTERVAL 12 MONTH`` behaviour.
    """
    today = date.today()
    cutoff = f"{today.year - 1}-{today.month:02d}"  # 'YYYY-MM', 12 months back

    def trend(col: str) -> list[dict]:
        return (
            df.filter(pl.col(col).is_not_null())
            .with_columns(_quarter_expr())
            .group_by(["quarter", col])
            .agg(pl.col("resale_price").median().alias("v"))
            .sort(["quarter", col])
            .rename({col: "series"})
            .select(["quarter", "series", "v"])
            .to_dicts()
        )

    box = (
        df.filter((pl.col("flat_type") == "4 ROOM") & (pl.col("month") >= cutoff))
        .group_by("town")
        .agg(
            pl.col("resale_price").min().alias("mn"),
            pl.col("resale_price").quantile(0.25, "linear").alias("q1"),
            pl.col("resale_price").median().alias("med"),
            pl.col("resale_price").quantile(0.75, "linear").alias("q3"),
            pl.col("resale_price").max().alias("mx"),
            pl.len().alias("n"),
        )
        .filter(pl.col("n") > 20)
        .sort("med", descending=True)
        .head(12)
        .select(["town", "mn", "q1", "med", "q3", "mx", "n"])
        .to_dicts()
    )

    # Median 4-room price per town over the same 12-month window as the box plot, for
    # ALL towns (the box plot keeps only the top 12) — feeds the landing choropleth,
    # keyed by town to web/public/geo/sg-towns.geojson. n lets the map flag thin towns.
    town_medians = (
        df.filter((pl.col("flat_type") == "4 ROOM") & (pl.col("month") >= cutoff))
        .group_by("town")
        .agg(
            pl.col("resale_price").median().alias("med"),
            pl.len().alias("n"),
        )
        .sort("town")
        .select(["town", "med", "n"])
        .to_dicts()
    )

    scatter_df = df.filter(
        (pl.col("flat_type") == "4 ROOM")
        & pl.col("cat_remaining_lease_years").is_not_null()
    ).select(
        pl.col("remaining_lease_years").alias("x"),
        pl.col("resale_price").alias("y"),
        pl.col("cat_remaining_lease_years").alias("band"),
    )
    scatter = scatter_df.sample(n=min(1800, scatter_df.height), seed=42).to_dicts()

    buckets = (
        df.filter(pl.col("cat_remaining_lease_years").is_not_null())
        .group_by("cat_remaining_lease_years")
        .agg(pl.len().alias("n"))
        .sort("cat_remaining_lease_years")
        .rename({"cat_remaining_lease_years": "band"})
        .select(["band", "n"])
        .to_dicts()
    )

    # First page of the recent-transactions table. The landing paints this straight from
    # the snapshot; changing a filter or paging past page 1 boots DuckDB in the browser
    # and re-queries with the same ORDER BY + LIMIT/OFFSET.
    recent_window = df.filter(pl.col("month") >= cutoff)
    recent = (
        recent_window.sort(["month", "resale_price"], descending=[True, True])
        .head(RECENT_PAGE_SIZE)
        .select(
            [
                "month",
                "town",
                "address",
                "flat_type",
                "floor_area_sqft",
                "resale_price",
                "psf",
            ]
        )
        .to_dicts()
    )

    # ---- landing KPI strip (Redfin-style) ----
    # Four headline metrics for the hero, each a last-12-month value paired with a
    # year-on-year delta against the preceding 12 months (recent_window vs prev_window).
    prev_cutoff = f"{today.year - 2}-{today.month:02d}"  # 24 months back
    prev_window = df.filter(
        (pl.col("month") >= prev_cutoff) & (pl.col("month") < cutoff)
    )

    def _kpi(now: float | None, prev: float | None) -> dict:
        yoy = (now - prev) / prev * 100 if (now is not None and prev) else None
        return {"value": now, "yoy": yoy}

    million = pl.col("resale_price") >= 1_000_000
    stats = {
        "medianPrice": _kpi(
            recent_window["resale_price"].median(), prev_window["resale_price"].median()
        ),
        "txns": _kpi(recent_window.height, prev_window.height),
        "millionDollar": _kpi(
            recent_window.filter(million).height, prev_window.filter(million).height
        ),
        "medianPsf": _kpi(recent_window["psf"].median(), prev_window["psf"].median()),
    }

    overview = {
        "trends": {
            "lease": trend("cat_remaining_lease_years"),
            "flat": trend("flat_type"),
            "town": trend("town"),
        },
        "box": box,
        "townMedians": town_medians,
        "subzoneMedians": _subzone_medians(df, cutoff),
        "scatter": scatter,
        "buckets": buckets,
        "recent": recent,
        "recentTotal": recent_window.height,
        # Option lists for the recent-transactions filters (populated without DuckDB).
        "towns": sorted(df["town"].unique().to_list()),
        "flatTypes": sorted(df["flat_type"].unique().to_list()),
        "stats": stats,
    }
    out = OUT_DIR / "overview.json"
    out.write_text(json.dumps(overview))
    print(f"Wrote overview.json ({out.stat().st_size / 1024:.1f} KB)")


def emit_town_analysis(df: pl.DataFrame) -> None:
    """Precompute the town-analysis default view into town-analysis.json.

    Mirrors the on-load queries in web/src/pages/town-analysis.astro: the town/flat
    option lists, the default town/flat map rows (last 24 months), and the highest
    recorded sale per town for the default flat. Rendering this lets the page paint
    without DuckDB; the engine only boots when the visitor changes a filter.
    """
    today = date.today()
    cutoff = f"{today.year - 2}-{today.month:02d}"  # 'YYYY-MM', 24 months back

    # Map rows for the default town/flat — mirrors renderMap()'s SELECT one-for-one.
    rows = (
        df.filter(
            (pl.col("town") == TA_DEFAULT_TOWN)
            & (pl.col("flat_type") == TA_DEFAULT_FLAT)
            & (pl.col("month") >= cutoff)
            & pl.col("latitude").is_not_null()
        )
        .sort(["month", "resale_price"], descending=[True, True])
        .select(
            pl.col("latitude").alias("lat"),
            pl.col("longitude").alias("lng"),
            pl.col("resale_price").alias("price"),
            "address",
            "month",
            pl.col("storey_range").alias("storey"),
            "psf",
            pl.col("remaining_lease_years").alias("lease"),
        )
        .to_dicts()
    )

    # Record sales for the default view — mirrors loadRecords()'s "This town" scope: the
    # selected town's own top sales on record across every flat type, with each sale's
    # context (type, address, storey, area, psf, month) and the median for that same flat
    # type in the town, so the outlier reads against a like-for-like typical. Only the
    # first page is precomputed; paging, changing town, or switching to the "All Singapore"
    # cross-town scope boots DuckDB (see town-analysis.astro).
    RECORDS_PAGE_SIZE = (
        8  # keep in sync with RECORDS_PAGE_SIZE in web/src/pages/town-analysis.astro
    )
    town_flat_med = df.group_by(["town", "flat_type"]).agg(
        pl.col("resale_price").median().alias("med")
    )
    default_town = df.filter(pl.col("town") == TA_DEFAULT_TOWN)
    records = (
        default_town.join(town_flat_med, on=["town", "flat_type"])
        .sort(["resale_price", "month"], descending=[True, True])
        .head(RECORDS_PAGE_SIZE)
        .select(
            "town",
            pl.col("resale_price").alias("price"),
            "address",
            pl.col("storey_range").alias("storey"),
            pl.col("floor_area_sqft").alias("area"),
            "month",
            pl.col("flat_type").alias("flat"),
            "psf",
            "med",
        )
        .to_dicts()
    )

    # Street list for the default town — populates the dependent street dropdown on
    # load. Mirrors loadStreets()'s DISTINCT query in town-analysis.astro.
    streets = (
        df.filter(pl.col("town") == TA_DEFAULT_TOWN)["street_name"]
        .unique()
        .sort()
        .to_list()
    )

    payload = {
        "default": {"town": TA_DEFAULT_TOWN, "flat": TA_DEFAULT_FLAT},
        "towns": sorted(df["town"].unique().to_list()),
        "flatTypes": sorted(df["flat_type"].unique().to_list()),
        "streets": streets,
        "rows": rows,
        "records": records,
        "recordsTotal": default_town.height,
    }
    out = OUT_DIR / "town-analysis.json"
    out.write_text(json.dumps(payload))
    print(f"Wrote town-analysis.json ({out.stat().st_size / 1024:.1f} KB)")


def emit_psf_trends(df: pl.DataFrame) -> None:
    """Precompute the psf-trends default view into psf-trends.json.

    Mirrors the on-load queries in web/src/pages/psf-trends.astro for the default
    filter (default town, all streets/storeys, since PSF_START): the town list, the
    default town's street list, the scatter sample, and the monthly median PSF. The
    regression fit + chart rendering are done client-side from these.
    """
    scope = df.filter(
        (pl.col("town") == PSF_DEFAULT_TOWN)
        & (pl.col("month") >= PSF_START)
        & pl.col("psf").is_not_null()
    )

    # Scatter sample — mirrors sampleSql(): all matching rows, or a random sample once
    # over the cap (matching the app's `USING SAMPLE n ROWS`).
    # Round the floats: the client formats psf/prices for display anyway, so trimming
    # 17-digit noise shrinks the JSON a lot with no visible change to the chart.
    sample_df = scope.select(
        "month",
        pl.col("psf").round(1),
        "address",
        pl.col("storey_range").alias("storey"),
        pl.col("resale_price").cast(pl.Int64).alias("price"),
        pl.col("remaining_lease_years").alias("lease"),
    )
    if sample_df.height > PSF_SCATTER_CAP:
        sample_df = sample_df.sample(n=PSF_SCATTER_CAP, seed=42)

    # Monthly median PSF + count — mirrors the median-by-month query.
    monthly = (
        scope.group_by("month")
        .agg(pl.col("psf").median().round(1).alias("med"), pl.len().alias("n"))
        .sort("month")
        .select(["month", "med", "n"])
        .to_dicts()
    )

    streets = (
        df.filter(pl.col("town") == PSF_DEFAULT_TOWN)["street_name"]
        .unique()
        .sort()
        .to_list()
    )

    payload = {
        "default": {"town": PSF_DEFAULT_TOWN},
        "towns": sorted(df["town"].unique().to_list()),
        "streets": streets,
        "sample": sample_df.to_dicts(),
        "monthly": monthly,
    }
    out = OUT_DIR / "psf-trends.json"
    out.write_text(json.dumps(payload))
    print(f"Wrote psf-trends.json ({out.stat().st_size / 1024:.1f} KB)")


def emit_flat_index(df: pl.DataFrame) -> None:
    """Precompute the postal -> block lookup into flat-index.json.

    Lets the my-flat-insights form resolve a postal and populate its dependent fields
    (flat types, storey bands, typical area, lease) WITHOUT booting DuckDB-WASM — the
    ~4.7 MB engine then loads in the background only for the valuation/comps/map. Mirrors
    resolveBlock() + onFlatChange() in web/src/pages/my-flat-insights.astro one-for-one:

      * block meta   — arg_max(town/street/address/lat/lng, month) (latest on record) plus
                        mode(flat_model) and mode(lease_commence_date).
      * per flat type — storey_range list ordered by min(storey_lower_bound), and the
                        median floor_area_sqft (rounded, as the form does). Flat types are
                        ordered by descending sale count, matching the page's ORDER BY n DESC.

    Keys are the numeric postal; float lat/lng are rounded to 6 dp (~11 cm) to trim JSON.
    """
    # Drop rows with no postal — they can't be looked up by the form.
    df = df.filter(pl.col("postal").is_not_null())

    # arg_max(col, month): the value at the latest month on record for the postal.
    latest = pl.col("month") == pl.col("month").max()
    meta = (
        df.group_by("postal")
        .agg(
            pl.col("town").filter(latest).first().alias("t"),
            pl.col("address").filter(latest).first().alias("ad"),
            pl.col("street_name").filter(latest).first().alias("st"),
            pl.col("latitude").filter(latest).first().alias("lat"),
            pl.col("longitude").filter(latest).first().alias("lng"),
            pl.col("flat_model").mode().first().alias("md"),
            pl.col("lease_commence_date").mode().first().alias("lc"),
        )
        .to_dicts()
    )

    # Storey bands per postal+flat, ordered by lower bound (mirrors GROUP BY storey_range
    # ORDER BY min(storey_lower_bound)).
    storeys = (
        df.group_by(["postal", "flat_type", "storey_range"])
        .agg(pl.col("storey_lower_bound").min().alias("lo"))
        .sort("lo")
        .group_by(["postal", "flat_type"])
        .agg(pl.col("storey_range").alias("sr"))
    )
    # Median area + sale count per postal+flat; count drives the flat-type ordering.
    per_flat = (
        df.group_by(["postal", "flat_type"])
        .agg(
            pl.col("floor_area_sqft").median().round(0).cast(pl.Int32).alias("a"),
            pl.len().alias("n"),
        )
        .join(storeys, on=["postal", "flat_type"])
        .sort(["postal", "n"], descending=[False, True])  # flats: most-sold first
        .to_dicts()
    )

    idx: dict[int, dict] = {}
    for r in meta:
        idx[r["postal"]] = {
            "t": r["t"],
            "ad": r["ad"],
            "st": r["st"],
            "lat": round(r["lat"], 6) if r["lat"] is not None else None,
            "lng": round(r["lng"], 6) if r["lng"] is not None else None,
            "md": r["md"],
            "lc": r["lc"],
            "ft": {},  # insertion order = descending sale count (preserved by JSON)
        }
    for r in per_flat:
        e = idx.get(r["postal"])
        if e is not None:
            e["ft"][r["flat_type"]] = {"sr": r["sr"], "a": r["a"]}

    # Shard by the first 2 digits of the zero-padded 6-digit postal. Singapore postals are
    # 6 digits, but districts 01-09 lose their leading zero as an int (e.g. 050004), so pad
    # before slicing. The client fetches only the ~5 KB shard for the prefix being typed
    # instead of the whole ~296 KB index — and prefetches it as the first digits are keyed
    # in. Entry keys are the int form (str(postal)), matching parseInt() on the client.
    old_single = OUT_DIR / "flat-index.json"
    if old_single.exists():
        old_single.unlink()  # superseded by the sharded directory below
    shard_dir = OUT_DIR / "flat-index"
    shard_dir.mkdir(parents=True, exist_ok=True)
    for old in shard_dir.glob("*.json"):
        old.unlink()
    shards: dict[str, dict] = {}
    for postal, entry in idx.items():
        shards.setdefault(f"{postal:06d}"[:2], {})[str(postal)] = entry
    total = 0
    for pp, entries in shards.items():
        f = shard_dir / f"{pp}.json"
        f.write_text(json.dumps(entries, separators=(",", ":")))
        total += f.stat().st_size
    print(
        f"Wrote flat-index/ ({len(shards)} shards, {total / 1024:.0f} KB total, {len(idx)} postals)"
    )


def emit_flat_aggregates(df: pl.DataFrame) -> None:
    """Precompute town x flat_type aggregates into flat-aggregates.json.

    Feeds the trajectory + lease-decay charts on my-flat-insights so they paint the
    moment a postal resolves, without DuckDB. Mirrors the corresponding queries in
    compute() (web/src/pages/my-flat-insights.astro):

      * traj  — median PSF, median price + count by calendar year, all history
                (GROUP BY substr(month,1,4)).
      * lease — town+flat median PSF by 10-year remaining-lease bucket, last 36 months,
                HAVING count >= 8.
      * island.lease — same by flat type island-wide, last 24 months, HAVING count >= 30
                (the page's fallback when a town's own curve is too thin).
      * island.med   — island median psf/price/area per flat type, last 12 months.

    psf is cast to Float64 before rounding so the JSON carries clean 1-dp values rather
    than Float32 binary noise.
    """
    today = date.today()

    def months_back(n: int) -> str:
        y, m = today.year, today.month - n
        while m <= 0:
            y -= 1
            m += 12
        return f"{y}-{m:02d}"

    psf1 = pl.col("psf").cast(pl.Float64).round(1)
    price0 = pl.col("resale_price").median().round(0).cast(pl.Int64)

    traj = (
        df.with_columns(pl.col("month").str.slice(0, 4).alias("yr"))
        .group_by(["town", "flat_type", "yr"])
        .agg(psf1.median().alias("psf"), price0.alias("price"), pl.len().alias("n"))
        .sort(["town", "flat_type", "yr"])
    )
    lease_town = (
        df.filter(pl.col("month") >= months_back(36))
        .with_columns((pl.col("remaining_lease_years") // 10 * 10).alias("b"))
        .group_by(["town", "flat_type", "b"])
        .agg(psf1.median().alias("psf"), pl.len().alias("n"))
        .filter(pl.col("n") >= 8)
        .sort(["town", "flat_type", "b"])
    )
    lease_island = (
        df.filter(pl.col("month") >= months_back(24))
        .with_columns((pl.col("remaining_lease_years") // 10 * 10).alias("b"))
        .group_by(["flat_type", "b"])
        .agg(psf1.median().alias("psf"), pl.len().alias("n"))
        .filter(pl.col("n") >= 30)
        .sort(["flat_type", "b"])
    )
    island_med = (
        df.filter(pl.col("month") >= months_back(12))
        .group_by("flat_type")
        .agg(
            psf1.median().alias("psf"),
            price0.alias("price"),
            pl.col("floor_area_sqft").median().round(0).cast(pl.Int32).alias("area"),
        )
    )

    by_town_flat: dict[str, dict] = {}
    for r in traj.to_dicts():
        key = f"{r['town']}|{r['flat_type']}"
        by_town_flat.setdefault(key, {}).setdefault("traj", []).append(
            [r["yr"], r["psf"], r["price"], r["n"]]
        )
    for r in lease_town.to_dicts():
        key = f"{r['town']}|{r['flat_type']}"
        by_town_flat.setdefault(key, {}).setdefault("lease", []).append(
            [r["b"], r["psf"]]
        )

    island: dict[str, dict] = {"lease": {}, "med": {}}
    for r in lease_island.to_dicts():
        island["lease"].setdefault(r["flat_type"], []).append([r["b"], r["psf"]])
    for r in island_med.to_dicts():
        island["med"][r["flat_type"]] = {
            "psf": r["psf"],
            "price": r["price"],
            "area": r["area"],
        }

    # Valuation comps: town+flat sales in the last 12 months, widened to 24 when a combo has
    # < 10 (mirrors compute()'s widen rule). We ship each comp's psf + storey_lower_bound so
    # the client runs the SAME storey-windowed quantile math it runs on DuckDB rows — an
    # identical valuation, range and PSF distribution without booting the engine. tp/ta are
    # the median comp price/area (the town benchmarks in section 03); the comps *table*, map
    # and priciest/lowest-sale tiles still come from DuckDB since they need per-row address.
    c12 = df.filter(pl.col("month") >= months_back(12))
    c24 = df.filter(pl.col("month") >= months_back(24))
    for cb in df.select(["town", "flat_type"]).unique().iter_rows(named=True):
        t, f = cb["town"], cb["flat_type"]
        sel = c12.filter((pl.col("town") == t) & (pl.col("flat_type") == f))
        months = 12
        if sel.height < 10:  # widen to 24 months when the 12-month window is too thin
            sel = c24.filter((pl.col("town") == t) & (pl.col("flat_type") == f))
            months = 24
        if sel.height == 0:
            continue
        d = sel.select(
            pl.col("psf").cast(pl.Float64).round(1).alias("psf"),
            pl.col("storey_lower_bound").alias("slo"),
        )
        by_town_flat.setdefault(f"{t}|{f}", {})["comps"] = {
            "m": months,
            "n": sel.height,
            "tp": int(round(sel["resale_price"].median())),
            "ta": int(round(sel["floor_area_sqft"].median())),
            "psf": d["psf"].to_list(),
            "slo": d["slo"].to_list(),
        }

    out = OUT_DIR / "flat-aggregates.json"
    out.write_text(
        json.dumps(
            {"byTownFlat": by_town_flat, "island": island}, separators=(",", ":")
        )
    )
    print(
        f"Wrote flat-aggregates.json ({out.stat().st_size / 1024:.0f} KB, {len(by_town_flat)} town×flat)"
    )


def emit() -> None:
    df = pl.read_parquet(SRC_PARQUET)
    df = df.drop([c for c in DROP_COLS if c in df.columns])

    # Sort so repeated low-cardinality values cluster (better ZSTD compression) and so
    # town-filtered queries can skip row groups via the town min/max statistics.
    df = df.sort(["town", "flat_type", "month"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Clean up the old year-shards from previous builds so nothing stale is served.
    for old in OUT_DIR.glob("resale-*.parquet"):
        old.unlink()

    out = OUT_DIR / "resale.parquet"
    df.write_parquet(
        out,
        compression="zstd",
        compression_level=19,
        statistics=True,
    )

    epoch = int(METADATA.read_text().strip()) if METADATA.exists() else None
    manifest = {
        "lastUpdatedEpoch": epoch,
        "lastUpdated": (
            datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")
            if epoch
            else None
        ),
        "rows": df.height,
        "file": out.name,
        "bytes": out.stat().st_size,
        "columns": df.columns,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    emit_overview(df)
    emit_town_analysis(df)
    emit_psf_trends(df)
    emit_flat_index(df)
    emit_flat_aggregates(df)

    size = out.stat().st_size
    print(f"Wrote {out.name}, {df.height:,} rows, {size/1e6:.2f} MB")
    # resale.parquet ships as a plain Cloudflare static asset, which caps individual
    # files at 25 MiB. Warn well before that so growth doesn't silently break deploys;
    # if we ever cross it, route the file through src/worker.ts (like the wasm) or R2.
    if size > 20 * 1024 * 1024:
        print(
            f"  WARNING: {out.name} is {size/1024/1024:.1f} MiB — approaching "
            "Cloudflare's 25 MiB static-asset cap."
        )


if __name__ == "__main__":
    emit()
