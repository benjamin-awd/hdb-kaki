<img src="./assets/logo.svg" width="396" height="91">

HDB Kaki helps you stay updated on the latest movements in the HDB resale market.

This repository is a fork of https://github.com/Joanna-Khek/hdb_resale_prices.

> **HDB Kaki has moved.** The app has been rebuilt and now lives at
> **[app.hdb-kaki.workers.dev](https://app.hdb-kaki.workers.dev)**. The old
> Streamlit app (`webapp/`) now only serves a migration notice; the data
> pipeline in `webapp/update/` continues to power the new site.

<h3 align="center">
    🔑 Try it out: <br>
    <a href="https://app.hdb-kaki.workers.dev/">https://app.hdb-kaki.workers.dev/</a>
</h3>

## Attribution
The data used in this application comes from the "Resale flat prices based on registration date from Jan-2017" dataset from [data.gov.sg](https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view) which is made available under the terms of the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence) v1.0.

## Developing

Install uv
```sh
pipx install uv
```

Install dependencies
```sh
uv sync
```

Fetch the data (not stored in git, see [Data](#data))
```sh
gh release download data --pattern csv.tar.gz --pattern df.parquet --pattern metadata --dir data --clobber
tar xzf data/csv.tar.gz
```

Run the app
```sh
streamlit run webapp/0_🔑_HDB_Kaki.py
```

## Data
The data lives in the `data` [GitHub Release](https://github.com/benjamin-awd/hdb-kaki/releases/tag/data), not in git, to keep clones small:

| Asset | What |
|---|---|
| `csv.tar.gz` | Monthly transaction CSVs (`data/YYYY-MM.csv`) plus `data/metadata`. The ETL's persistent store, including cached OneMap geocodes |
| `df.parquet` | All months combined; the input for `webapp/update/emit_web.py` |
| `metadata` | Unix epoch of the last data change |

The daily `Auto-update` workflow restores `csv.tar.gz`, runs the ETL, and publishes all three back.
