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

# Default view the town-analysis page renders on load. MUST match the DEFAULT_TOWN /
# DEFAULT_FLAT constants in web/src/pages/town-analysis.astro.
TA_DEFAULT_TOWN = "ANG MO KIO"
TA_DEFAULT_FLAT = "4 ROOM"

# Default view psf-trends renders on load. MUST match DEFAULT_TOWN / START / SCATTER_CAP
# in web/src/pages/psf-trends.astro.
PSF_DEFAULT_TOWN = "ANG MO KIO"
PSF_START = "2020-01"
PSF_SCATTER_CAP = 6000

# Columns dropped for the web: derivable or unused by any page.
#   _id, _ts        — internal ETL bookkeeping
#   remaining_lease — string form; kept as remaining_lease_years
#   block           — redundant; address already begins with the block
DROP_COLS = ["_id", "_ts", "remaining_lease", "block"]


def _quarter_expr() -> pl.Expr:
    """'YYYY-MM' -> 'YYYY Qn'. Mirrors the quarterExpr string in index.astro."""
    year = pl.col("month").str.slice(0, 4)
    mm = pl.col("month").str.slice(5, 2).cast(pl.Int32)
    quarter = ((mm - 1) // 3 + 1).cast(pl.Utf8)
    return (year + pl.lit(" Q") + quarter).alias("quarter")


def emit_overview(df: pl.DataFrame, anchor: date) -> None:
    """Precompute the four landing-page charts + recent table into overview.json.

    Each block mirrors the corresponding query in web/src/pages/index.astro. The
    12-month window is measured back from ``anchor`` — the data's last-updated date
    (data/metadata), not wall-clock — so it tracks the data's own age and stays put
    on days the data doesn't change. The landing page renders entirely from this JSON
    with no client-side re-query, so the window can never diverge in the browser.
    """
    cutoff = f"{anchor.year - 1}-{anchor.month:02d}"  # 'YYYY-MM', 12 months back

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

    recent_window = df.filter(pl.col("month") >= cutoff)
    recent = (
        recent_window.sort(["month", "resale_price"], descending=[True, True])
        .head(8)
        .select(
            ["month", "town", "address", "flat_type", "floor_area_sqft", "resale_price", "psf"]
        )
        .to_dicts()
    )

    overview = {
        "trends": {
            "lease": trend("cat_remaining_lease_years"),
            "flat": trend("flat_type"),
            "town": trend("town"),
        },
        "box": box,
        "scatter": scatter,
        "buckets": buckets,
        "recent": recent,
        "recentTotal": recent_window.height,
    }
    out = OUT_DIR / "overview.json"
    out.write_text(json.dumps(overview))
    print(f"Wrote overview.json ({out.stat().st_size / 1024:.1f} KB)")


def emit_town_analysis(df: pl.DataFrame, anchor: date) -> None:
    """Precompute the town-analysis default view into town-analysis.json.

    Mirrors the on-load queries in web/src/pages/town-analysis.astro: the town/flat
    option lists, the default town/flat map rows (last 24 months), and the highest
    recorded sale per town for the default flat. Rendering this lets the page paint
    without DuckDB; the engine only boots when the visitor changes a filter.

    The 24-month window is measured back from ``anchor`` (the data's last-updated
    date, not wall-clock) and the resolved ``cutoff`` is shipped in the JSON. The
    page binds its live DuckDB re-query to that same cutoff, so the default snapshot
    and a filter-triggered query resolve the identical window — they can't diverge.
    """
    cutoff = f"{anchor.year - 2}-{anchor.month:02d}"  # 'YYYY-MM', 24 months back

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

    # Highest sale per town for the default flat — mirrors renderHighest()'s query.
    highest = (
        df.filter(pl.col("flat_type") == TA_DEFAULT_FLAT)
        .group_by("town")
        .agg(pl.col("resale_price").max().alias("mx"))
        .sort("mx", descending=True)
        .head(15)
        .select(["town", "mx"])
        .to_dicts()
    )

    payload = {
        "default": {"town": TA_DEFAULT_TOWN, "flat": TA_DEFAULT_FLAT},
        "cutoff": cutoff,  # 'YYYY-MM'; the page reuses this for its live re-query
        "towns": sorted(df["town"].unique().to_list()),
        "flatTypes": sorted(df["flat_type"].unique().to_list()),
        "rows": rows,
        "highest": highest,
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
        df.filter(pl.col("town") == PSF_DEFAULT_TOWN)["street_name"].unique().sort().to_list()
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
    # Anchor the rolling windows to the data's last-updated date rather than wall-clock,
    # so the precomputed snapshots and the browser's live re-query resolve the SAME
    # window (see emit_town_analysis / town-analysis.astro) and staleness tracks the
    # data's age, not how long ago the site was rebuilt. Falls back to today when the
    # metadata stamp is absent (e.g. a fresh clone with no ETL run yet).
    anchor = datetime.fromtimestamp(epoch, tz=timezone.utc).date() if epoch else date.today()
    manifest = {
        "lastUpdatedEpoch": epoch,
        "lastUpdated": datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")
        if epoch
        else None,
        "rows": df.height,
        "file": out.name,
        "bytes": out.stat().st_size,
        "columns": df.columns,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    emit_overview(df, anchor)
    emit_town_analysis(df, anchor)
    emit_psf_trends(df)

    size = out.stat().st_size
    print(f"Wrote {out.name}, {df.height:,} rows, {size/1e6:.2f} MB")
    # resale.parquet ships as a plain Cloudflare static asset, which caps individual
    # files at 25 MiB. Warn well before that so growth doesn't silently break deploys;
    # if we ever cross it, route the file through src/worker.ts (like the wasm) or R2.
    if size > 20 * 1024 * 1024:
        print(f"  WARNING: {out.name} is {size/1024/1024:.1f} MiB — approaching "
              "Cloudflare's 25 MiB static-asset cap.")


if __name__ == "__main__":
    emit()
