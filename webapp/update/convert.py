from pathlib import Path

import polars as pl

from webapp.read import schema
from webapp.update import hdb_postals
from webapp.utils import get_project_root


def convert_lease(x):
    # Bands cover leases 1-99. Anything outside (null, 0, >99) returns None so the row
    # drops out of the lease-band views (the frontend filters IS NOT NULL and hardcodes
    # exactly these three bands) instead of raising UnboundLocalError and aborting the ETL.
    if x is None:
        result = None
    elif 0 < x <= 60:
        result = "0-60 years"
    elif 60 < x <= 80:
        result = "61-80 years"
    elif 80 < x <= 99:
        result = "81-99 years"
    else:
        result = None
    return result


def csv_to_parquet() -> pl.DataFrame:
    """Combine all CSV files in the specified directory into a single parquet file"""
    data_dir: Path = get_project_root() / "data"

    df = pl.read_csv(data_dir / "*.csv", schema=schema)

    df = df.unique()
    df = df.with_columns(
        (
            pl.col("remaining_lease")
            .str.extract(r"(\d+)", 1)
            .cast(pl.Int64)
            .alias("remaining_lease_years")
        )
    )

    df = df.with_columns(
        pl.col("remaining_lease_years")
        .map_elements(convert_lease, pl.String)
        .alias("cat_remaining_lease_years")
    )

    df = df.with_columns(
        [
            (pl.col("floor_area_sqm") * 10.7639)
            .alias("floor_area_sqft")
            .cast(pl.Int16),
            (pl.col("resale_price") / (pl.col("floor_area_sqm") * 10.7639)).alias(
                "psf"
            ),
        ]
    )

    df = df.with_columns(
        [
            pl.col("storey_range")
            .str.split_exact(" TO ", 1)
            .struct.field("field_0")
            .cast(pl.Int32)
            .alias("storey_lower_bound"),
            pl.col("storey_range")
            .str.split_exact(" TO ", 1)
            .struct.field("field_1")
            .cast(pl.Int32)
            .alias("storey_upper_bound"),
        ]
    )

    df = correct_geocoded_postals(df, data_dir)

    df = df.sort(by="_ts")
    df.write_parquet(data_dir / "df.parquet")
    return


def correct_geocoded_postals(df: pl.DataFrame, data_dir: Path) -> pl.DataFrame:
    """Snap geocoded postals/coordinates/lease to HDB's authoritative block reference.

    Strict on purpose: the pipeline owns the "one postal, one block, one lease" invariant
    the frontend relies on. A data.gov.sg outage or any residual bad data raises and aborts
    the ETL rather than silently shipping a parquet that would resurface the mixed-lease bug.
    """
    ref = hdb_postals.load_reference(data_dir / hdb_postals.CACHE_NAME)
    df, postal_changes = hdb_postals.correct_postals(df, ref)
    df, lease_changes = hdb_postals.canonicalise_lease_commence(df)

    with pl.Config(tbl_rows=-1):
        if postal_changes.height:
            print(
                f"Corrected mis-postalled rows across {postal_changes.height} blocks:"
            )
            print(postal_changes)
        if lease_changes.height:
            print(f"Canonicalised lease_commence for {lease_changes.height} blocks:")
            print(lease_changes)

    hdb_postals.validate_blocks(df, ref)
    return df


if __name__ == "__main__":
    csv_to_parquet()
