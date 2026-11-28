<img src="./assets/logo.svg" width="396" height="91">

HDB Kaki helps you stay updated on the latest movements in the HDB resale market.

<h3 align="center">
    🔑 Try it out: <br>
    <a href="https://app.hdb-kaki.workers.dev/">https://app.hdb-kaki.workers.dev/</a>
</h3>

## Developing

The site is a static [Astro](https://astro.build) app in `web/`. Its data is generated
by the Python pipeline in `webapp/update/`.

Requirements: [Bun](https://bun.sh) and [uv](https://docs.astral.sh/uv/).

```sh
cd web
bun install
bun run setup   # fetch the data from the GitHub Release and generate web/public/data/
bun run dev
```

Re-run `bun run setup` whenever you want the latest data.

Other useful scripts (run from `web/`):

| Command | What |
|---|---|
| `bun run build` / `bun run preview` | Production build, and serve it locally |
| `bun run check` / `bun run lint` | Type-check and lint |
| `bun run test:unit` | Unit tests |
| `bun run test` | Playwright end-to-end tests |

### Working on the ETL

The daily ETL (`webapp/update/etl.py`) reads and updates the monthly CSVs, so fetch
those too:

```sh
uv sync
scripts/setup-data.sh --csv
DATAGOV_API_KEY=... ONEMAP_EMAIL=... ONEMAP_PASSWORD=... uv run webapp/update/etl.py
```

## Data
The data lives in the `data` [GitHub Release](https://github.com/benjamin-awd/hdb-kaki/releases/tag/data), not in git, to keep clones small:

| Asset | What |
|---|---|
| `csv.tar.gz` | Monthly transaction CSVs (`data/YYYY-MM.csv`) plus `data/metadata`. The ETL's persistent store, including cached OneMap geocodes |
| `df.parquet` | All months combined; the input for `webapp/update/emit_web.py` |
| `metadata` | Unix epoch of the last data change |

The daily `Auto-update` workflow restores `csv.tar.gz`, runs the ETL, and publishes all three back.

## Attribution
This repository is a fork of https://github.com/Joanna-Khek/hdb_resale_prices.

The data used in this application comes from the "Resale flat prices based on registration date from Jan-2017" dataset from [data.gov.sg](https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view) which is made available under the terms of the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence) v1.0.
