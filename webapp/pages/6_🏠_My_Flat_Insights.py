from datetime import datetime, timedelta

import polars as pl
import streamlit as st

from webapp.logo import icon, logo
from webapp.read import load_dataframe

st.set_page_config(
    page_title="My Flat Insights | HDB Kaki", page_icon=icon, layout="wide"
)

RED = "#fe012b"

st.image(logo, width=400)
st.markdown("## My Flat Insights")
st.markdown(
    "Enter your postal code and flat details to get an indicative valuation, "
    "see how it benchmarks against the market, and browse recent comparable sales."
)

df = load_dataframe()

# --- shared styling for the valuation hero ---
st.markdown(
    f"""
    <style>
    .val-card {{border:1px solid #e4ddd0;border-radius:14px;padding:26px 30px;background:#fffdf8;height:100%;}}
    .val-label {{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8c8479;font-weight:600;}}
    .val-big {{font-size:52px;font-weight:700;letter-spacing:-.02em;color:#181410;line-height:1.05;margin:6px 0 4px;}}
    .val-range {{color:#5b544a;font-size:15px;}}
    .val-range b {{color:#181410;}}
    .rb-track {{position:relative;height:10px;border-radius:999px;background:#efeadf;margin-top:22px;}}
    .rb-fill {{position:absolute;top:0;bottom:0;left:0;right:0;border-radius:999px;background:{RED};opacity:.35;}}
    .rb-marker {{position:absolute;top:50%;width:16px;height:16px;border-radius:50%;background:{RED};
        border:3px solid #fff;transform:translate(-50%,-50%);box-shadow:0 3px 8px rgba(254,1,43,.5);}}
    .rb-scale {{display:flex;justify-content:space-between;margin-top:12px;font-size:12px;color:#8c8479;}}
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------------------------------------------------------------------------
# 1. Postal code lookup
# ---------------------------------------------------------------------------
# Default to the block with the most transactions so the page renders a full
# example on first load (guarantees comparables exist).
default_postal = (
    df.group_by("postal").len().sort("len", descending=True).select("postal").row(0)[0]
)

lookup_col, addr_col = st.columns([1, 3])
with lookup_col:
    postal_input = st.text_input("Postal code", value=str(default_postal), max_chars=6)

try:
    postal = int(postal_input)
except (ValueError, TypeError):
    st.warning("Please enter a valid postal code.")
    st.stop()

block_df = df.filter(pl.col("postal") == postal)
if block_df.is_empty():
    st.warning(
        f"No resale transactions found for postal code **{str(postal).zfill(6)}**. "
        "Insights are only available for blocks with past resale transactions — "
        "try another postal code."
    )
    st.stop()

latest = block_df.sort("month", descending=True).row(0, named=True)
town = latest["town"]
street = latest["street_name"]
address = latest["address"]

with addr_col:
    st.markdown("&nbsp;")  # align with the input label
    st.markdown(f"📍 &nbsp;**{address.title()}** · {town.title()}")


# ---------------------------------------------------------------------------
# 2. Flat details (auto-filled from the block, user can override)
# ---------------------------------------------------------------------------
flat_types = sorted(block_df["flat_type"].unique())

c1, c2, c3, c4 = st.columns(4)
with c1:
    flat_type = st.selectbox("Flat type", flat_types)

# Reference rows for defaults: this block + flat type, falling back to the block.
flat_block = block_df.filter(pl.col("flat_type") == flat_type)
ref = flat_block if not flat_block.is_empty() else block_df

storey_options = (
    ref.select("storey_range", "storey_lower_bound")
    .unique()
    .sort("storey_lower_bound")["storey_range"]
    .to_list()
)
with c2:
    storey = st.selectbox("Storey", storey_options, index=len(storey_options) // 2)

default_area = int(ref["floor_area_sqft"].median())
with c3:
    floor_area_sqft = st.number_input(
        "Floor area (sqft)", min_value=200, max_value=3000, value=default_area, step=1
    )

lc_series = ref["lease_commence_date"].drop_nulls()
lease_commence = int(lc_series.mode().to_list()[0]) if len(lc_series) else 1990
default_lease = max(1, min(99, 99 - (datetime.today().year - lease_commence)))
with c4:
    remaining_lease = st.number_input(
        "Remaining lease (years)",
        min_value=1,
        max_value=99,
        value=default_lease,
        step=1,
    )


# ---------------------------------------------------------------------------
# 3. Build the comparable set (same flat type + town, most recent window)
# ---------------------------------------------------------------------------
def build_comps(months_back: int) -> pl.DataFrame:
    cutoff = datetime.today().replace(day=1) - timedelta(days=30 * months_back)
    return df.filter(
        (pl.col("flat_type") == flat_type)
        & (pl.col("town") == town)
        & (pl.col("month") >= cutoff)
    )


comps = build_comps(12)
window_label = "last 12 months"
if comps.height < 10:
    comps = build_comps(24)
    window_label = "last 24 months"

if comps.is_empty():
    st.warning(
        "Not enough recent comparable transactions in this town to estimate a value."
    )
    st.stop()


# ---------------------------------------------------------------------------
# 4. Valuation
# ---------------------------------------------------------------------------
median_psf = comps["psf"].median()
low = comps["psf"].quantile(0.25) * floor_area_sqft
high = comps["psf"].quantile(0.75) * floor_area_sqft
estimate = median_psf * floor_area_sqft
n = comps.height

conf_label = (
    "High"
    if n >= 30
    else "Medium-High" if n >= 15 else "Medium" if n >= 5 else "Low"
)

st.markdown("### 01 · Estimated valuation")

hero_left, hero_right = st.columns([1.3, 1])
with hero_left:
    marker_pct = (estimate - low) / (high - low) * 100 if high > low else 50
    marker_pct = max(4, min(96, marker_pct))
    st.markdown(
        f"""
        <div class="val-card">
          <div class="val-label">Estimated market value</div>
          <div class="val-big">${estimate:,.0f}</div>
          <div class="val-range">Likely range
            <b>${low:,.0f}</b> – <b>${high:,.0f}</b></div>
          <div class="rb-track">
            <div class="rb-fill"></div>
            <div class="rb-marker" style="left:{marker_pct:.0f}%;"></div>
          </div>
          <div class="rb-scale">
            <span>${low:,.0f}</span><span>estimate</span><span>${high:,.0f}</span>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with hero_right:
    m1, m2 = st.columns(2)
    m1.metric("Comparable sales", f"{n}")
    m2.metric("Median PSF (comps)", f"${median_psf:,.0f}")
    m3, m4 = st.columns(2)
    m3.metric("Confidence", conf_label)
    m4.metric("Basis", window_label.replace("last ", ""))
    st.caption(
        "Indicative estimate for guidance only — not a valuation for HDB, bank or "
        "CPF purposes. Based on registered resale transactions from data.gov.sg."
    )

with st.expander("How this is calculated"):
    st.markdown(
        f"""
        - **Comparables:** {n} resale transactions of **{flat_type}** flats in
          **{town.title()}** over the **{window_label}**.
        - **Estimate** = median PSF of those comparables (**${median_psf:,.0f}**)
          × your floor area (**{floor_area_sqft:,} sqft**).
        - **Range** = 25th–75th percentile PSF of the comparables × your floor area.
        - The estimate is not adjusted for storey height or exact remaining lease.
        """
    )


# ---------------------------------------------------------------------------
# 5. Benchmarking
# ---------------------------------------------------------------------------
one_year_ago = datetime.today().replace(day=1) - timedelta(days=365)
island = df.filter(
    (pl.col("flat_type") == flat_type) & (pl.col("month") >= one_year_ago)
)

town_price = comps["resale_price"].median()
town_area = comps["floor_area_sqft"].median()
town_lease = comps["remaining_lease_years"].median()
island_psf = island["psf"].median()


def pct(part, whole):
    return (part / whole - 1) * 100 if whole else 0.0


st.markdown("### 02 · How it benchmarks")

b1, b2, b3 = st.columns(3)
b1.metric(
    "Estimated value",
    f"${estimate:,.0f}",
    f"{pct(estimate, town_price):+.1f}% vs town median",
)
b2.metric(
    "Floor area",
    f"{floor_area_sqft:,} sqft",
    f"{pct(floor_area_sqft, town_area):+.1f}% vs town typical",
)
b3.metric(
    "Town PSF",
    f"${median_psf:,.0f}",
    f"{pct(median_psf, island_psf):+.1f}% vs island-wide",
)

# Lease position on the 99-year runway.
st.markdown("**Lease position**")
lease_col, lease_meta = st.columns([3, 1])
with lease_col:
    st.progress(remaining_lease / 99)
with lease_meta:
    st.markdown(
        f"**{remaining_lease}** of 99 yrs &nbsp;·&nbsp; "
        f"town median **{town_lease:.0f}** yrs"
    )


# ---------------------------------------------------------------------------
# 6. Nearby comparables (same-street first, then most recent)
# ---------------------------------------------------------------------------
st.markdown("### 03 · Nearby comparables")
st.caption(
    f"Recent **{flat_type}** sales in **{town.title()}** ({window_label}), "
    "same street first."
)

table_col, map_col = st.columns([1.6, 1])

with table_col:
    comps_display = (
        comps.with_columns((pl.col("street_name") == street).alias("same_street"))
        .sort(by=["same_street", "month"], descending=[True, True])
        .select(
            pl.col("month").dt.strftime("%Y-%m").alias("Sold"),
            pl.col("address").str.to_titlecase().alias("Address"),
            pl.col("storey_range").alias("Storey"),
            pl.col("floor_area_sqft").alias("Area (sqft)"),
            pl.col("remaining_lease_years").alias("Lease (yrs)"),
            pl.col("resale_price").cast(pl.Int64).alias("Price"),
            pl.col("psf").round(0).cast(pl.Int64).alias("PSF"),
        )
        .head(50)
    )
    st.dataframe(
        comps_display,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Price": st.column_config.NumberColumn(format="$%d"),
            "PSF": st.column_config.NumberColumn(format="$%d"),
        },
    )

with map_col:
    # latitude/longitude are Float32 in the schema; st.map serialises to JSON
    # and can't handle float32, so cast to Float64.
    coords = [pl.col("latitude").cast(pl.Float64), pl.col("longitude").cast(pl.Float64)]
    comp_pts = (
        comps.filter(pl.col("latitude").is_not_null())
        .select(coords)
        .unique()
        .with_columns(pl.lit("#c9bfae").alias("color"), pl.lit(45).alias("size"))
    )
    user_pts = (
        block_df.filter(pl.col("latitude").is_not_null())
        .select(coords)
        .unique()
        .with_columns(pl.lit(RED).alias("color"), pl.lit(90).alias("size"))
    )
    map_pts = pl.concat([comp_pts, user_pts])
    if not map_pts.is_empty():
        st.map(
            map_pts.to_pandas(),
            latitude="latitude",
            longitude="longitude",
            color="color",
            size="size",
        )
