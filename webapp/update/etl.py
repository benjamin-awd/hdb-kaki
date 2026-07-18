import sys
import time
from pathlib import Path
import polars as pl

from webapp.read import get_project_root, schema
from webapp.update.convert import csv_to_parquet
from webapp.update.emit_web import METADATA, emit
from webapp.update.extract import extract, get_timestamps


def update_data():
    """Executes ETL process end-to-end: fetch → parquet → web artifacts.

    Emitting the web artifacts here means a single ``etl.py`` run leaves
    web/public/data ready to preview locally. In CI the deploy workflow re-emits
    against the release parquet, but keeping it in one place makes the pipeline
    correct from a single command.
    """
    csv_file_glob: Path = get_project_root() / "data" / "*.csv"
    df = pl.read_csv(csv_file_glob, schema=schema)

    start, end = get_timestamps(df)
    has_changed = extract([start, end, "-f"])
    csv_to_parquet()

    if has_changed:
        # Advance the data's last-updated stamp only when the CSVs actually changed, so
        # the rolling-window anchor (read by emit_web below) tracks data age rather than
        # wall-clock. Written before emit() so the manifest + window cutoffs pick it up.
        METADATA.write_text(str(int(time.time())))
        print("Changes detected")

    emit()
    sys.exit(0)


if __name__ == "__main__":
    update_data()
