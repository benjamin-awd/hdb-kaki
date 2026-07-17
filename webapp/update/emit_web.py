"""Emit web artifacts for the static frontend (see wireframes/REBUILD_PLAN.md).

Reads the combined ``data/df.parquet`` (produced by ``convert.csv_to_parquet``) and
writes year-sharded, ZSTD-compressed, column-trimmed Parquet into ``web/public/data/``
along with a ``manifest.json``. Standalone (polars only) so it does not depend on the
Streamlit-Cloud path baked into ``webapp.utils.get_project_root``.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
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

    total = sum(f["bytes"] for f in files)
    print(f"Wrote {len(files)} shards, {df.height:,} rows, {total/1e6:.2f} MB total")
    for f in files:
        print(f"  {f['file']:>18}  {f['rows']:>7,} rows  {f['bytes']/1e6:6.2f} MB")


if __name__ == "__main__":
    emit()
