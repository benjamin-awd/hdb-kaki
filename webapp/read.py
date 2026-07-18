import polars as pl

schema = {
    "_id": pl.Int64,
    "month": pl.Utf8,
    "town": pl.Utf8,
    "flat_type": pl.Utf8,
    "block": pl.Utf8,
    "street_name": pl.Utf8,
    "storey_range": pl.Utf8,
    "floor_area_sqm": pl.Float32,
    "flat_model": pl.Utf8,
    "lease_commence_date": pl.Int16,
    "remaining_lease": pl.Utf8,
    "resale_price": pl.Float32,
    "address": pl.Utf8,
    "postal": pl.Int32,
    "latitude": pl.Float32,
    "longitude": pl.Float32,
    "_ts": pl.Utf8,
}
