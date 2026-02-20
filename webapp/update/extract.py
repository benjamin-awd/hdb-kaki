from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import pandas as pd
import requests
from dateutil.relativedelta import relativedelta
from numpy import nan
from tqdm import tqdm


@lru_cache
def extract_hdb_data(year_month):
    data = {
        "filters": f'{{"month":"{year_month}"}}',
        "limit": "14000",
    }
    search_url = "https://data.gov.sg/api/action/datastore_search?resource_id=d_8b84c4ee58e3cfc0ece0d773c8ca6abc"

    response = requests.request("GET", search_url, params=data)
    return response.json()["result"]["records"]


def get_data(start_date="2019-01", end_date=pd.Timestamp.now().strftime("%Y-%m")):
    dates = (
        pd.date_range(start=start_date, end=end_date, freq="MS")
        .strftime("%Y-%m")
        .tolist()
    )

    all_items = []
    for date in dates:
        res = extract_hdb_data(date)
        all_items.extend(res)

    df = pd.DataFrame(all_items)
    if df.empty:
        return pd.DataFrame()

    df["address"] = df["block"] + " " + df["street_name"]
    return df.reset_index(drop=True)


def fetch_osm_postal(query_address, session: requests.Session):
    query_string = f"https://nominatim.openstreetmap.org/search?q={query_address}&format=json&addressdetails=1"

    response = session.get(query_string).json()

    if not response:
        return None

    return response[0]["address"].get("postcode", None)


def fetch_map_data(query_address, session: requests.Session):
    query_string = (
        "https://www.onemap.gov.sg/api/common/elastic/search?&searchVal="
        + query_address
        + "&returnGeom=Y&getAddrDetails=Y"
    )

    response = session.get(query_string).json()["results"][0]

    if response:
        postal_code = response["POSTAL"]
        # use open street map if postal code is null or invalid
        if len(str(postal_code)) < 6:
            postal_code = fetch_osm_postal(query_address, session)

    return {
        "address": query_address,
        "postal": postal_code,
        "latitude": response["LATITUDE"],
        "longitude": response["LONGITUDE"],
    }


def get_map_results(data):
    headers = {
        "User-Agent": "HDB Kaki/1.0 (https://hdb-kaki.streamlit.app/)",
        "Referer": "https://hdb-kaki.streamlit.app/",
    }

    unique_address = list(dict.fromkeys(data["address"]))
    with requests.Session() as session:
        session.headers = headers
        with ThreadPoolExecutor() as executor:
            results = list(
                tqdm(
                    executor.map(
                        lambda addr: fetch_map_data(addr, session), unique_address
                    ),
                    total=len(unique_address),
                )
            )

    return pd.DataFrame(results)


def load_existing_data(file_path: Path) -> pd.DataFrame:
    """Load existing data from a CSV file if it exists, otherwise return an empty DataFrame."""
    if file_path.exists():
        df = pd.read_csv(
            file_path,
            dtype={
                "_id": "Int64",
                "month": str,
                "town": str,
                "flat_type": str,
                "block": str,
                "street_name": str,
                "storey_range": str,
                "floor_area_sqm": float,
                "flat_model": str,
                "lease_commence_date": "Int64",
                "remaining_lease": str,
                "resale_price": float,
                "address": str,
                "postal": "Int64",
                "latitude": float,
                "longitude": float,
            },
        )

        return df

    return pd.DataFrame()


def skip_process(file_path: Path, should_process: bool) -> bool:
    """Determine if the file should be processed based on its existence and if it's the current month."""
    if file_path.exists() and not should_process:
        print(f"File {file_path} exists and is not the current month. Skipping.")
        return False
    return True


def process_new_addresses(
    new_data: pd.DataFrame, existing_data: pd.DataFrame
) -> pd.DataFrame | None:
    """Process new addresses and fetch map data for them."""
    new_addresses = set(new_data["address"]) - set(existing_data["address"])
    if not new_addresses:
        return None

    print(f"Processing {len(new_addresses)} new addresses")
    addresses_to_process = new_data[new_data["address"].isin(new_addresses)]
    map_data = get_map_results(addresses_to_process)
    return addresses_to_process.merge(map_data, how="left", on="address")


def process_month(month: str, data_dir: Path, should_process: bool = False):
    """Process and save data for a given month."""
    file_path = data_dir / f"{month}.csv"

    if not skip_process(file_path, should_process):
        return False

    # 1. Download new data for the month
    new_data = get_data(start_date=month, end_date=month)
    if new_data.empty:
        print(f"No data found for {month}")
        return False

    existing_data = load_existing_data(file_path)
    if not existing_data.empty and len(new_data) == len(existing_data):
        print(f"Data size not updated {month}, skip processing...")
        return False

    property_coords = pd.DataFrame(columns=["address", "postal", "latitude", "longitude"])
    new_addresses = new_data.drop_duplicates(subset="address")

    if not existing_data.empty:
        print(f"Found {existing_data.shape[0]} existing records in {month}.")
        property_coords = (
            existing_data[["address", "postal", "latitude", "longitude"]]
            .drop_duplicates(subset="address")
            .dropna(subset="postal")
        )
        existing_addresses = set(property_coords["address"])
        new_addresses = new_data[
            ~new_data["address"].isin(existing_addresses)
        ].drop_duplicates(subset="address")

        missing_lat_lon = existing_data[["latitude", "longitude"]].isna().any(axis=1)
        if missing_lat_lon.any():
            print(
                f"Updating missing latitude and longitude for existing addresses in {month}"
            )
            addresses_to_update = existing_data[missing_lat_lon]
            new_addresses = pd.concat([new_addresses, addresses_to_update]).drop_duplicates(
                subset="address"
            )

    if not new_addresses.empty:
        print(f"Fetching latitude and longitude for new addresses in {month}")
        new_map_data = get_map_results(new_addresses)
        property_coords = pd.concat(
            [existing_data[["address", "postal", "latitude", "longitude"]], new_map_data]
        )

    # 3. Merge Coordinates
    # Remove existing coord cols from new_data if present to avoid overlap
    new_data = new_data.drop(
        columns=[c for c in ["postal", "latitude", "longitude"] if c in new_data.columns]
    )
    merged_df = new_data.merge(property_coords, on="address", how="left")

    # 4. Combine with existing data and deduplicate

    if not existing_data.empty:
        ts_map = existing_data.set_index("_id")["_ts"]
        ts_map = ts_map[~ts_map.index.duplicated(keep="first")]

        merged_df["_ts"] = merged_df["_id"].map(ts_map)

    df = merged_df
    print(f"Total number of observations for {month}: {df.shape[0]}")

    # 5. Add/Fill Timestamp

    # the _id column isn't chronological, so the only way to
    # differentiate "new" rows added upstream is to
    # create a timestamp with the current date
    today = datetime.today().strftime("%Y-%m-%d")
    df["_ts"] = df.get("_ts", nan)
    df["_ts"] = df["_ts"].fillna(today)

    df = df.astype(
        {
            "_id": int,
            "month": str,
            "town": str,
            "flat_type": str,
            "block": str,
            "street_name": str,
            "storey_range": str,
            "floor_area_sqm": float,
            "flat_model": str,
            "lease_commence_date": int,
            "remaining_lease": str,
            "resale_price": float,
            "address": str,
            "postal": "Int64",
            "latitude": float,
            "longitude": float,
            "_ts": str,
        }
    )

    df = df.sort_values(by="_ts", ascending=False)

    df.to_csv(file_path, index=False)
    return True


def get_timestamps(df=None) -> tuple[str, str]:
    current_timestamp = datetime.now()
    current_month = current_timestamp.strftime("%Y-%m")

    if df is not None:
        last_month = df["month"].max()
    else:
        last_month = (datetime.now() - relativedelta(months=1)).strftime("%Y-%m")

    return last_month, current_month


def extract(raw_args=None):
    parser = ArgumentParser(description="Fetch HDB and map data.")
    parser.add_argument("start_date", type=str, help="Start date in YYYY-MM format")
    parser.add_argument("end_date", type=str, help="End date in YYYY-MM format")
    parser.add_argument("-f", "--force", action="store_true")
    args = parser.parse_args(raw_args)

    data_dir = Path("data")
    data_dir.mkdir(exist_ok=True)

    start_date = pd.to_datetime(args.start_date, format="%Y-%m")
    end_date = pd.to_datetime(args.end_date, format="%Y-%m")
    months = (
        pd.date_range(start=start_date, end=end_date, freq="MS")
        .strftime("%Y-%m")
        .tolist()
    )
    last_month, current_month = get_timestamps()

    all_changed = False
    for month in months:
        should_process = args.force or month in (last_month, current_month)
        month_changed = process_month(month, data_dir, should_process)
        if month_changed:
            all_changed = True
    return all_changed
