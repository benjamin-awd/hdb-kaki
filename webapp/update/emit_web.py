"""Emit web artifacts for the static frontend (see wireframes/REBUILD_PLAN.md).

Reads the combined ``data/df.parquet`` (produced by ``convert.csv_to_parquet``) and
writes a single ZSTD-compressed, column-trimmed ``resale.parquet`` into
``web/public/data/`` along with a ``manifest.json``. Standalone (polars only) so it
does not depend on the Streamlit-Cloud path baked into ``webapp.utils.get_project_root``.

The data is emitted as ONE file rather than year-shards: the client fetches it once and
decodes it in a Web Worker, and every query spans all years, so sharding only multiplied
the round-trips (one fetch + decode per file) with no pruning benefit. A single file is
one request and one decode — far cheaper first query.

Also precomputes ``overview.json`` (landing page) and ``town-analysis.json`` (the
town-analysis default view) so those pages paint from a single small fetch instead of
loading the data worker in the browser on load. The queries here mirror each page's
client-side query one-for-one so the numbers stay identical; the worker only loads when
the visitor changes a filter.
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

# Columns kept for the precompute snapshots but NOT shipped in resale.parquet: the web
# client never reads them, so dropping them from the shipped file cuts download + decode.
# cat_remaining_lease_years still feeds the landing scatter/lease charts, so it stays in the
# frame passed to the emit_* precomputes; only the written parquet drops these.
WEB_DROP_COLS = ["floor_area_sqm", "cat_remaining_lease_years", "storey_upper_bound"]


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
    # the snapshot; changing a filter or paging past page 1 queries the data worker in the
    # browser with the same ordering + page slice.
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
        # Option lists for the recent-transactions filters (populated without the worker).
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
    without the data worker; it only loads when the visitor changes a filter.
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
    # cross-town scope queries the data worker (see town-analysis.astro).
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


def emit() -> None:
    df = pl.read_parquet(SRC_PARQUET)
    df = df.drop([c for c in DROP_COLS if c in df.columns])

    # int64 -> int32 for the small integer columns the web client reads: postal,
    # lease_commence_date and storey_lower_bound all fit in int32, and it lets the browser
    # Parquet decoder return plain numbers instead of boxing every value as a BigInt.
    df = df.with_columns(
        [
            pl.col(c).cast(pl.Int32)
            for c in ("postal", "lease_commence_date", "storey_lower_bound")
            if c in df.columns
        ]
    )

    # Sort so repeated low-cardinality values cluster (better ZSTD compression) and so
    # town-filtered queries can skip row groups via the town min/max statistics.
    df = df.sort(["town", "flat_type", "month"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Clean up the old year-shards from previous builds so nothing stale is served.
    for old in OUT_DIR.glob("resale-*.parquet"):
        old.unlink()

    out = OUT_DIR / "resale.parquet"
    # Ship only the columns the web client reads; the dropped ones stay in `df` for the
    # precompute snapshots below (which still use cat_remaining_lease_years).
    web = df.drop([c for c in WEB_DROP_COLS if c in df.columns])
    web.write_parquet(
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
        "rows": web.height,
        "file": out.name,
        "bytes": out.stat().st_size,
        "columns": web.columns,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    emit_overview(df)
    emit_town_analysis(df)
    emit_psf_trends(df)

    size = out.stat().st_size
    print(f"Wrote {out.name}, {web.height:,} rows, {size/1e6:.2f} MB")
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
