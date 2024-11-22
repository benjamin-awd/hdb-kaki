from datetime import datetime

import numpy as np
import plotly.express as px
import polars as pl
import streamlit as st

from webapp.filter import SidebarFilter

st.set_page_config(layout="wide")

st.title("📈 PSF Trend Analysis")
st.write("The trend for the price of a resale flat is plotted below.")

sf = SidebarFilter(
    min_date=datetime(2020, 1, 1).date(),
    select_towns=(True, "multi"),
    select_street=True,
    default_town="ANG MO KIO",
)

storey_range_filter = st.sidebar.slider(
    "Select storey range bound (inclusive)",
    sf.df["storey_lower_bound"].min(),
    sf.df["storey_upper_bound"].max(),
    value=(sf.df["storey_lower_bound"].min(), sf.df["storey_upper_bound"].max()),
)

filtered_df = sf.df.filter(
    (pl.col("storey_lower_bound") >= storey_range_filter[0])
    & (pl.col("storey_upper_bound") <= storey_range_filter[1])
)

trendline = st.sidebar.selectbox("Select regression type", options=["ols", "lowess"])

# Create the scatter plot with trendline
fig = px.scatter(
    filtered_df,
    x="month",
    y="psf",
    trendline_scope="overall",
    trendline=trendline,
    hover_data=["remaining_lease_years", "address", "storey_range"],
)

scatter_trace = fig.data[0]
scatter_trace.update(
    hovertemplate="Month: %{x|%Y-%m}<br>"
    + "psf: S$%{y:.2f} <br>"
    + "Lease Years: %{customdata[0]} years<br>"
    + "Address: %{customdata[1]}<br>"
    + "Storey: %{customdata[2]}<br>"
)

trendline_trace = fig.data[1]

trendline_trace.update(
    # line_color="red",
    hovertemplate="<b>OLS Trendline:</b><br>"
    + "Month: %{x}<br>"
    + "psf: S$%{y:.2f} <b>(trend)</b><br>"
    + "<extra></extra>",  # This removes the extra trace information (like trace name)
)

fig.update_layout(
    hoverdistance=150,
    xaxis_title="Month",
    yaxis_title="Price per Square Foot ($)",
)

st.plotly_chart(fig, height=700)

if trendline == "ols":
    results = px.get_trendline_results(fig)

    rsquared = results.px_fit_results.iloc[0].rsquared.round(3)
    psf_values = np.unique(trendline_trace.y)
    current_trend_psf = psf_values[-1].round(2)
    last_month_psf = psf_values[-2].round(2)

    psf_diff_percentage = ((current_trend_psf - last_month_psf) / last_month_psf) * 100

    current_month = str(filtered_df["month"].max())[:7]

    col1, col2, col3 = st.columns(3)
    col1.metric("Current Month", current_month)
    col2.metric(
        "Current psf (trend)", f"S${current_trend_psf}", f"{psf_diff_percentage:.2f}%"
    )
    col3.metric("R²", rsquared)

    months = [str(month) for month in np.unique(trendline_trace.x)]
    psf_values = np.unique(trendline_trace.y)
    trend_df = pl.DataFrame({"month": months, "psf (trend)": psf_values})
    trend_df = trend_df.with_columns(pl.col("psf (trend)").round(2))

    trend_df = trend_df.with_columns(pl.col("month").str.slice(0, length=7)).sort(
        by="month", descending=True
    )

    st.write("### Trend price per month")
    st.dataframe(trend_df)
