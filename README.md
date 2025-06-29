<img src="./assets/logo.svg" width="396" height="91">

HDB Kaki helps you stay updated on the latest movements in the HDB resale market.

This repository is a fork of https://github.com/Joanna-Khek/hdb_resale_prices.

<h3 align="center">
    🔑 Try it out: <br>
    <a href="https://hdb-kaki.streamlit.app/">https://hdb-kaki.streamlit.app/</a>
</h3>

<p align="center">
    <img src="./assets/hdb-kaki.gif" width=800>
</p>

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

Run the app
```sh
streamlit run webapp/0_🔑_HDB_Kaki.py
```
