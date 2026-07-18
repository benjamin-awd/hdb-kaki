"""Emit web artifacts for the static frontend (see wireframes/REBUILD_PLAN.md).

Reads the combined ``data/df.parquet`` (produced by ``convert.csv_to_parquet``) and
writes a single ZSTD-compressed, column-trimmed ``resale.parquet`` into
``web/public/data/`` along with a ``manifest.json``. Standalone (polars only) so it
does not depend on the Streamlit-Cloud path baked into ``webapp.utils.get_project_root``.

The data is emitted as ONE file rather than year-shards: DuckDB-WASM reads it over HTTP
range requests, and every query spans all years, so sharding only multiplied the
sequential round-trips (footer + column reads per file) with no pruning benefit. A
single file is read in one pass — far fewer requests, much faster first query.

Also precomputes ``overview.json`` — the landing page's aggregates (price trends,
distribution, lease relationship, recent transactions) so the landing renders from a
single small fetch instead of booting DuckDB-WASM in the browser. The queries here
mirror the SQL in ``web/src/pages/index.astro`` one-for-one so the numbers stay identical.
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
        "lastUpdated": datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")
        if epoch
        else None,
        "rows": df.height,
        "file": out.name,
        "bytes": out.stat().st_size,
        "columns": df.columns,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    emit_overview(df)

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
