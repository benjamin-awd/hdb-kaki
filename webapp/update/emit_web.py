"""Emit web artifacts for the static frontend (see wireframes/REBUILD_PLAN.md).

Reads the combined ``data/df.parquet`` (produced by ``convert.csv_to_parquet``) and
writes year-sharded, ZSTD-compressed, column-trimmed Parquet into ``web/public/data/``
along with a ``manifest.json``. Standalone (polars only) so it does not depend on the
Streamlit-Cloud path baked into ``webapp.utils.get_project_root``.

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

    # ---- landing KPI strip (Redfin-style) ----
    # Four headline metrics for the hero, each a last-12-month value paired with a
    # year-on-year delta against the preceding 12 months (recent_window vs prev_window).
    prev_cutoff = f"{today.year - 2}-{today.month:02d}"  # 24 months back
    prev_window = df.filter((pl.col("month") >= prev_cutoff) & (pl.col("month") < cutoff))

    def _kpi(now: float | None, prev: float | None) -> dict:
        yoy = (now - prev) / prev * 100 if (now is not None and prev) else None
        return {"value": now, "yoy": yoy}

    million = pl.col("resale_price") >= 1_000_000
    stats = {
        "medianPrice": _kpi(recent_window["resale_price"].median(), prev_window["resale_price"].median()),
        "txns": _kpi(recent_window.height, prev_window.height),
        "millionDollar": _kpi(recent_window.filter(million).height, prev_window.filter(million).height),
        "medianPsf": _kpi(recent_window["psf"].median(), prev_window["psf"].median()),
    }

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
        "stats": stats,
    }
    out = OUT_DIR / "overview.json"
    out.write_text(json.dumps(overview))
    print(f"Wrote overview.json ({out.stat().st_size / 1024:.1f} KB)")


def emit() -> None:
    df = pl.read_parquet(SRC_PARQUET)
    df = df.drop([c for c in DROP_COLS if c in df.columns])

    # year for sharding; sort so repeated low-cardinality values cluster (better compression)
    df = df.with_columns(pl.col("month").str.slice(0, 4).alias("year")).sort(
        ["town", "flat_type", "month"]
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("resale-*.parquet"):
        old.unlink()

    years = sorted(df["year"].unique().to_list())
    files = []
    for year in years:
        shard = df.filter(pl.col("year") == year).drop("year")
        out = OUT_DIR / f"resale-{year}.parquet"
        shard.write_parquet(
            out,
            compression="zstd",
            compression_level=19,
            row_group_size=shard.height or 1,
            statistics=True,
        )
        files.append({"year": year, "file": out.name, "rows": shard.height,
                      "bytes": out.stat().st_size})

    epoch = int(METADATA.read_text().strip()) if METADATA.exists() else None
    manifest = {
        "lastUpdatedEpoch": epoch,
        "lastUpdated": datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")
        if epoch
        else None,
        "rows": df.height,
        "years": years,
        "shards": files,
        "columns": df.drop("year").columns,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    emit_overview(df)

    total = sum(f["bytes"] for f in files)
    print(f"Wrote {len(files)} shards, {df.height:,} rows, {total/1e6:.2f} MB total")
    for f in files:
        print(f"  {f['file']:>18}  {f['rows']:>7,} rows  {f['bytes']/1e6:6.2f} MB")


if __name__ == "__main__":
    emit()
