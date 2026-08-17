"""Snap geocoded resale postals/coordinates to HDB's authoritative block reference.

Resale rows are geocoded via OneMap (``webapp/update/extract.py``), whose first-result
heuristic occasionally returns the wrong building. Sometimes it is a single recent row
(a block accidentally sharing another block's postal), and sometimes a whole block has
been wrong for years (e.g. ``11 HOLLAND DR`` carried ``278859``, a postal that does not
exist in HDB's data, instead of ``271011``). Either way a physical block ends up with
more than one postal, which breaks the my-flat-insights block lookup (``resolveBlockQuery``):
it reads a block's address off the latest transaction but derives other fields from the
postal, so a mixed postal shows one block's address beside another block's lease.

HDB publishes an authoritative building map (data.gov.sg dataset
``d_16b157c52ed637edd6ba1232e026258d``, "HDB Existing Building"): every building has a
unique ``(BLK_NO, ST_COD)`` and a unique ``POSTAL_COD`` (verified 1:1:1). ``ST_COD`` is a
street *code* rather than a name, so we bootstrap ``street_name -> ST_COD`` from the resale
rows whose postal is already authoritative, then resolve every row's true postal from
``(block, ST_COD)`` and overwrite where it disagrees. Rows on the few streets whose code is
ambiguous, or that we cannot resolve, are left untouched.

Run standalone to refresh the cached reference::

    uv run python -m webapp.update.hdb_postals
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import polars as pl

DATASET_ID = "d_16b157c52ed637edd6ba1232e026258d"
CACHE_NAME = "_ignore_hdb_postals.parquet"


def _get_json(url: str, timeout: int) -> dict:
    # data.gov.sg's S3 blobs 403 the default urllib user-agent; send a browser-like one.
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (hdb-kaki build)"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _fetch_geojson() -> dict:
    poll = f"https://api-open.data.gov.sg/v1/public/api/datasets/{DATASET_ID}/poll-download"
    url = _get_json(poll, 30)["data"]["url"]
    return _get_json(url, 120)


def _centroid(geometry: dict) -> tuple[float, float]:
    """Mean of every coordinate in a (Multi)Polygon, precise enough for a map marker."""
    xs: list[float] = []
    ys: list[float] = []

    def walk(node):
        if node and isinstance(node[0], (int, float)):
            xs.append(node[0])
            ys.append(node[1])
        else:
            for child in node:
                walk(child)

    walk(geometry["coordinates"])
    return sum(ys) / len(ys), sum(xs) / len(xs)


def build_reference() -> pl.DataFrame:
    """Reduce the HDB building GeoJSON to ``[blk_no, st_cod, postal, bldg_lat, bldg_lng]``."""
    gj = _fetch_geojson()
    records = []
    for feature in gj["features"]:
        props = feature["properties"]
        postal = str(props.get("POSTAL_COD") or "")
        if not postal.isdigit():
            continue
        lat, lng = _centroid(feature["geometry"])
        records.append(
            {
                "blk_no": props["BLK_NO"],
                "st_cod": props["ST_COD"],
                "postal": int(postal),
                "bldg_lat": lat,
                "bldg_lng": lng,
            }
        )
    return pl.DataFrame(records).with_columns(
        pl.col("postal").cast(pl.Int32),
        pl.col("bldg_lat").cast(pl.Float32),
        pl.col("bldg_lng").cast(pl.Float32),
    )


def load_reference(cache_path: Path, refresh: bool = False) -> pl.DataFrame:
    """Return the block reference, downloading and caching it on first use."""
    if refresh or not cache_path.exists():
        ref = build_reference()
        ref.write_parquet(cache_path)
        return ref
    return pl.read_parquet(cache_path)


def correct_postals(
    df: pl.DataFrame, ref: pl.DataFrame
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Overwrite each row's ``postal``/``latitude``/``longitude`` with the authoritative
    value for its physical block. Returns ``(corrected_df, changes)`` where ``changes`` lists
    the distinct ``block``/``street_name``/old/new postals that were fixed."""
    valid = ref.get_column("postal")

    # Bootstrap street -> ST_COD from rows we can trust. A mis-postalled row often carries a
    # postal that *is* a real HDB postal but points at a different block (e.g. 9B Boon Tiong
    # sat on 28 Tiong Bahru's postal), so being valid is not enough: keep only rows whose
    # postal's own block number matches the row's block, which excludes the mis-postalled ones.
    known = (
        df.filter(pl.col("postal").is_in(valid))
        .join(ref.select(["postal", "blk_no", "st_cod"]), on="postal", how="inner")
        .filter(pl.col("blk_no") == pl.col("block"))
    )
    # (block, street) is the precise key; street alone is the fallback for whole-block errors
    # (a block that is entirely mis-postalled has no authoritative row of its own to learn from,
    # but its neighbours on the same street do). Keep only unambiguous mappings.
    key_map = (
        known.group_by(["block", "street_name"])
        .agg(
            pl.col("st_cod").n_unique().alias("n"),
            pl.col("st_cod").first().alias("st_cod"),
        )
        .filter(pl.col("n") == 1)
        .select(["block", "street_name", "st_cod"])
    )
    street_map = (
        known.group_by("street_name")
        .agg(
            pl.col("st_cod").n_unique().alias("n"),
            pl.col("st_cod").first().alias("st_cod_street"),
        )
        .filter(pl.col("n") == 1)
        .select(["street_name", "st_cod_street"])
    )

    auth = ref.rename(
        {
            "blk_no": "block",
            "postal": "auth_postal",
            "bldg_lat": "auth_lat",
            "bldg_lng": "auth_lng",
        }
    )
    resolved = (
        df.join(key_map, on=["block", "street_name"], how="left")
        .join(street_map, on="street_name", how="left")
        .with_columns(pl.col("st_cod").fill_null(pl.col("st_cod_street")))
        .join(
            auth.select(["block", "st_cod", "auth_postal", "auth_lat", "auth_lng"]),
            on=["block", "st_cod"],
            how="left",
        )
    )

    # Overwrite when the authoritative postal disagrees, including rows the geocoder left
    # null (a resolvable street/block still yields the right postal and coordinates).
    changed = pl.col("auth_postal").is_not_null() & (
        pl.col("postal").is_null() | (pl.col("auth_postal") != pl.col("postal"))
    )
    changes = (
        resolved.filter(changed)
        .select(["block", "street_name", "postal", "auth_postal"])
        .unique()
        .sort(["street_name", "block"])
    )
    corrected = resolved.with_columns(
        pl.when(changed)
        .then(pl.col("auth_postal"))
        .otherwise(pl.col("postal"))
        .alias("postal"),
        pl.when(changed)
        .then(pl.col("auth_lat"))
        .otherwise(pl.col("latitude"))
        .alias("latitude"),
        pl.when(changed)
        .then(pl.col("auth_lng"))
        .otherwise(pl.col("longitude"))
        .alias("longitude"),
    ).drop(["st_cod", "st_cod_street", "auth_postal", "auth_lat", "auth_lng"])
    return corrected, changes


def canonicalise_lease_commence(
    df: pl.DataFrame,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Collapse each block's ``lease_commence_date`` to its most common value.

    A physical block was built once, so every unit shares one commence year; a rare
    single-row typo (e.g. 37 Teban Gdns Rd showing 1981 among 1966s) otherwise leaves a
    postal mapping to two leases, which is exactly the inconsistency the block lookup trips
    on. Keyed by the already-corrected postal. Returns ``(df, changes)``."""
    canon = (
        df.filter(pl.col("postal").is_not_null())
        .group_by("postal")
        .agg(pl.col("lease_commence_date").mode().first().alias("canon_lc"))
    )
    joined = df.join(canon, on="postal", how="left")
    changed = pl.col("canon_lc").is_not_null() & (
        pl.col("canon_lc") != pl.col("lease_commence_date")
    )
    changes = (
        joined.filter(changed)
        .select(["postal", "lease_commence_date", "canon_lc"])
        .unique()
        .sort("postal")
    )
    out = joined.with_columns(
        pl.when(changed)
        .then(pl.col("canon_lc"))
        .otherwise(pl.col("lease_commence_date"))
        .alias("lease_commence_date")
    ).drop("canon_lc")
    return out, changes


def validate_blocks(df: pl.DataFrame, ref: pl.DataFrame) -> None:
    """Raise ``ValueError`` if any row still carries bad block data after correction.

    The pipeline owns the invariant the frontend depends on: every postal is a real HDB
    postal and maps to exactly one block and one lease. We fail loudly rather than ship a
    parquet that would resurface the mixed-lease bug."""
    valid = ref.get_column("postal")
    located = df.filter(pl.col("postal").is_not_null())
    problems: list[tuple[str, pl.DataFrame]] = []

    unknown = located.filter(~pl.col("postal").is_in(valid))
    if unknown.height:
        problems.append(
            ("postals absent from the HDB reference", _distinct_blocks(unknown))
        )
    missing = df.filter(pl.col("postal").is_null())
    if missing.height:
        problems.append(("rows with no postal", _distinct_blocks(missing)))
    for field, label in [
        ("lease_commence_date", "lease_commence_date"),
        ("address", "block"),
    ]:
        mixed = (
            located.group_by("postal")
            .agg(pl.col(field).n_unique().alias("n"))
            .filter(pl.col("n") > 1)
        )
        if mixed.height:
            problems.append((f"postals mapping to >1 {label}", mixed.sort("postal")))

    if problems:
        report = "\n".join(
            f"\n{label} ({frame.height}):\n{frame}" for label, frame in problems
        )
        raise ValueError(f"HDB block validation failed:{report}")


def _distinct_blocks(df: pl.DataFrame) -> pl.DataFrame:
    cols = [c for c in ("block", "street_name", "postal") if c in df.columns]
    return df.select(cols).unique().sort(cols)


if __name__ == "__main__":
    from webapp.utils import get_project_root

    dest = get_project_root() / "data" / CACHE_NAME
    ref = load_reference(dest, refresh=True)
    print(f"Wrote {ref.height} HDB buildings to {dest}")
