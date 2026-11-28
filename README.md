<img src="./assets/logo.svg" width="396" height="91">

HDB Kaki helps you stay updated on the latest movements in the HDB resale market.

<h3 align="center">
    🔑 Try it out: <br>
    <a href="https://app.hdb-kaki.workers.dev/">https://app.hdb-kaki.workers.dev/</a>
</h3>

## Developing

The site is a static [Astro](https://astro.build) app in `web/`; the data pipeline is in `webapp/update/`.

Requirements: [Bun](https://bun.sh) and [uv](https://docs.astral.sh/uv/).

```sh
cd web
bun install
bun run setup   # fetch the data (see Data below); re-run for the latest
bun run dev
```

Other useful scripts (run from `web/`):

| Command | What |
|---|---|
| `bun run build` / `bun run preview` | Production build, and serve it locally |
| `bun run check` / `bun run lint` | Type-check and lint |
| `bun run test:unit` | Unit tests |
| `bun run test` | Playwright end-to-end tests |

### Working on the ETL

The ETL (`webapp/update/etl.py`) also needs the monthly CSVs:

```sh
uv sync
scripts/setup-data.sh --csv
DATAGOV_API_KEY=... ONEMAP_EMAIL=... ONEMAP_PASSWORD=... uv run webapp/update/etl.py
```

## Data
The data lives in the `data` [GitHub Release](https://github.com/benjamin-awd/hdb-kaki/releases/tag/data), not in git, to keep clones small. The daily `Auto-update` workflow refreshes it.

| Asset | What |
|---|---|
| `csv.tar.gz` | Monthly transaction CSVs (`data/YYYY-MM.csv`), the ETL's source of truth, including cached OneMap geocodes |
| `df.parquet` | All months combined; the input for `webapp/update/emit_web.py` |
| `metadata` | Unix epoch of the last data change |

## Attribution
This project started out as a fork of [hdb_resale_prices](https://github.com/Joanna-Khek/hdb_resale_prices),
a Streamlit app by [Joanna Khek](https://github.com/Joanna-Khek). Thanks for the original idea and groundwork!

### Data sources

- **[data.gov.sg](https://data.gov.sg)**, used under the [Singapore Open Data Licence v1.0](https://data.gov.sg/open-data-licence):
  - [Resale flat prices based on registration date from Jan-2017 onwards](https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view) (HDB): the resale transactions
  - [HDB Existing Building](https://data.gov.sg/datasets/d_16b157c52ed637edd6ba1232e026258d/view) (HDB): block postal codes
  - [Master Plan 2019 Planning Area Boundary](https://data.gov.sg/datasets/d_4765db0e87b9c86336792efe8a1f7a66/view) and [Subzone Boundary](https://data.gov.sg/datasets/d_8594ae9ff96d0c708bc2af633048edfb/view) (URA): town and subzone maps
  - [Hawker Centres](https://data.gov.sg/datasets/d_4a086da0a5553be1d89383cd90d07ecd/view) (NEA): nearby amenities and food
- **[OneMap](https://www.onemap.gov.sg)** (Singapore Land Authority): address geocoding and MRT/LRT station locations
- **[Singapore Food Agency](https://www.sfa.gov.sg)** Track Records: licensed food outlets
- **[OpenStreetMap](https://www.openstreetmap.org/copyright)** © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/): amenities such as supermarkets, and fallback geocoding via Nominatim
- **[CARTO](https://carto.com/attributions)**: basemap tiles
- **Wikipedia** station articles: locations of announced future MRT stations

HDB Kaki is an independent project and is not affiliated with or endorsed by HDB or any Singapore government agency.
