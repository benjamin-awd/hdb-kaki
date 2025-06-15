from datetime import datetime, timedelta

import plotly.express as px
import plotly.graph_objects as go
import polars as pl
import streamlit as st
from plotly.subplots import make_subplots

from webapp.filter import SidebarFilter
from webapp.logo import icon, logo
from webapp.read import get_last_updated_badge, load_dataframe

st.set_page_config(page_title="HDB Kaki", page_icon=icon, layout="wide")

st.image(logo, width=500)

last_updated_badge = get_last_updated_badge()
st.image(last_updated_badge)

st.markdown("## Resale Visualizations")

st.markdown(
    "HDB Kaki helps you stay updated on the latest movements in the HDB resale market."
)

group_by = st.radio(
    "Group by:",
    ("Lease Years", "Town", "Flat Type"),
)

source = "Source: <a href='https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view'>data.gov.sg</a>"
annotations = dict(
    margin=dict(l=50, r=50, t=100, b=100),
    annotations=[
        dict(
            x=0.5,
            y=-0.33,
            xref="paper",
            yref="paper",
            text=source,
            showarrow=False,
        )
    ],
    height=500,
)


def plot_lease_years(sf: SidebarFilter):
    """Plot percentage change in median resale price by lease years."""
    chart_df = (
        sf.df.group_by(["quarter_label", "cat_remaining_lease_years"])
        .agg(pl.median("resale_price").alias("median_resale_price"))
        .sort(["cat_remaining_lease_years", "quarter_label"])
        .with_columns(
            (
                (
                    pl.col("median_resale_price")
                    / pl.first("median_resale_price").over("cat_remaining_lease_years")
                    - 1
                )
                * 100
            ).alias("percentage_change")
        )
        .sort(by="quarter_label")
    )

    fig = px.line(
        chart_df,
        x="quarter_label",
        y="percentage_change",
        color="cat_remaining_lease_years",
        title=f"Percentage Change in Median Resale Price since {str(sf.start_date)[:7]}",
        labels={
            "percentage_change": "Percentage Change (%)",
            "quarter_label": "Quarter",
            "cat_remaining_lease_years": "Remaining Lease Years",
        },
    )

    fig.update_yaxes(ticksuffix="%")
    fig.update_traces(hovertemplate="%{y:.2f}%")
    fig.update_layout(hovermode="x unified", **annotations)

    st.plotly_chart(fig, use_container_width=True)


def plot_town(sf: SidebarFilter):
    """Plot median resale price and transaction volumes by town."""
    show_transaction_volumes = st.sidebar.checkbox(
        "Show transaction volumes", value=False
    )

    chart_df = (
        sf.df.group_by(["quarter_label", "town"])
        .agg(
            pl.median("resale_price").alias("resale_price"),
            pl.count("resale_price").alias("transaction_volume"),
        )
        .sort(["town", "quarter_label"])
    )

    fig = make_subplots(rows=1, cols=1, specs=[[{"secondary_y": True}]])

    for town in chart_df["town"].unique().sort():
        town_df = chart_df.filter(pl.col("town") == town)

        fig.add_trace(
            go.Scatter(
                x=town_df["quarter_label"],
                y=town_df["resale_price"],
                mode="lines",
                name=town,
                hovertemplate="$%{y}",
                line=dict(shape="spline"),
            ),
            secondary_y=False,
        )

        if show_transaction_volumes:
            fig.add_trace(
                go.Bar(
                    x=town_df["quarter_label"],
                    y=town_df["transaction_volume"],
                    name=town,
                    hovertemplate="%{y} transactions",
                ),
                secondary_y=True,
            )

    fig.update_xaxes(tickformat="%Y-%m")
    fig.update_yaxes(
        showgrid=False, zeroline=False, secondary_y=True, showticklabels=False
    )

    custom_layout = {
        "yaxis": dict(
            range=[
                chart_df["resale_price"].min() * 0.6,
                chart_df["resale_price"].max() * 1.2,
            ]
        ),
        "yaxis2": (
            dict(range=[0, chart_df["transaction_volume"].max() * 15])
            if show_transaction_volumes
            else {}
        ),
    }

    fig.update_layout(
        title="Median Resale Price by Town",
        yaxis_title="Median Resale Price",
        hovermode="x unified",
        barmode="stack",
        **custom_layout,
        **annotations,
    )

    st.plotly_chart(fig, use_container_width=True)

def plot_flat_type(sf: SidebarFilter):
    """Plot median resale price, showing interpolated values as a dotted line."""
    
    # 1. Aggregate your data
    agg_df = (
        sf.df.group_by(["quarter_label", "flat_type"])
        .agg(pl.median("resale_price").alias("resale_price"))
    )

    # 2. Create the complete data grid
    all_quarters = sf.df["quarter_label"].unique().sort()
    all_flat_types = sf.df["flat_type"].unique().sort()
    grid_df = pl.DataFrame({'quarter_label': all_quarters}).join(
        pl.DataFrame({'flat_type': all_flat_types}), how='cross'
    )

    # 3. Join data to grid, creating nulls for missing data
    chart_df_with_gaps = grid_df.join(
        agg_df, on=["quarter_label", "flat_type"], how="left"
    )

    # 4. Flag the rows that will be interpolated
    data_to_plot = chart_df_with_gaps.sort(["flat_type", "quarter_label"]).with_columns(
        is_interpolated = pl.col("resale_price").is_null()
    )

    # 5. Now, create the final DataFrame with interpolated values
    final_df = data_to_plot.with_columns(
        resale_price = pl.col("resale_price").interpolate().over("flat_type")
    )

    # --- Plotting Section ---
    fig = go.Figure()
    
    # Get Plotly's default qualitative color sequence
    colors = px.colors.qualitative.Plotly

    # MODIFICATION: Use enumerate to get an index for selecting colors
    for i, flat_type in enumerate(all_flat_types):
        # Select a color from the cycle. Use modulo to loop through colors if needed.
        color = colors[i % len(colors)]
        
        flat_type_df = final_df.filter(pl.col("flat_type") == flat_type)

        # Create a series for actual data points (null where interpolated)
        actual_prices = flat_type_df.with_columns(
            actual=pl.when(pl.col("is_interpolated")).then(None).otherwise(pl.col("resale_price"))
        )["actual"]

        # Add the INTERPOLATED trace (dotted line, in the background)
        # MODIFICATION: Use the assigned color instead of "grey"
        fig.add_trace(go.Scatter(
            x=flat_type_df["quarter_label"],
            y=flat_type_df["resale_price"], 
            mode="lines",
            line=dict(color=color, dash='dot', width=2),
            legendgroup=flat_type,
            showlegend=False, 
            hovertemplate="Interpolated: $%{y:,.0f}"
        ))

        fig.add_trace(go.Scatter(
            x=flat_type_df["quarter_label"],
            y=actual_prices, 
            mode="lines",
            line=dict(color=color, width=3),
            name=flat_type,
            legendgroup=flat_type,
            showlegend=True, 
            hovertemplate="Actual: $%{y:,.0f}"
        ))

    fig.update_layout(
        title_text="Median Resale Price by Flat Type",
        xaxis_title="Quarter",
        yaxis_title="Median Resale Price ($)",
        xaxis_tickformat="%Y-%m",
        legend_title_text="Flat Type"
    )

    st.plotly_chart(fig, use_container_width=True)


sf = SidebarFilter(
    min_date=datetime.strptime("2017-01-01", "%Y-%m-%d").date(),
    select_towns=(True, "multi"),
    select_lease_years=True,
    select_storey=True,
    default_town="ANG MO KIO" if group_by == "Town" else None,
)

if group_by == "Lease Years":
    plot_lease_years(sf)
if group_by == "Town":
    plot_town(sf)
if group_by == "Flat Type":
    plot_flat_type(sf)

st.markdown("### Recent transactions")
st.dataframe(
    sf.df.filter(
        pl.col("month") >= datetime.today().replace(day=1) - timedelta(days=365)
    )
    .select(
        "_ts",
        pl.col("month").dt.strftime("%Y-%m").alias("month_sold"),
        "town",
        "address",
        "flat_type",
        "resale_price",
        "floor_area_sqft",
        "psf",
        "storey_range",
        "remaining_lease",
        "quarter_label",
    )
    .sort(by="_ts", descending=True)
)

st.markdown("### Download")
st.write(
    "Download the full dataset for resale flat prices based on registration date from Jan-2017 onwards"
)
st.write(
    "Note: the original dataset can be found here: [data.gov.sg](https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view)."
)
st.download_button(
    "Download CSV",
    load_dataframe().write_csv(),
    "hdb_resale_data.csv",
    "text/csv",
    key="download-csv",
)


def plot_qoq_change(sf: SidebarFilter):
    """Plot quarter-on-quarter percentage change in median resale price by lease years."""
    # Count the transactions for each quarter and lease year
    transaction_count_df = sf.df.group_by(
        ["quarter_label", "cat_remaining_lease_years"]
    ).agg(pl.count("resale_price").alias("transaction_count"))

    # Get the latest quarter in the data
    latest_quarter = (
        sf.df.select("quarter_label").sort("quarter_label", descending=True).row(0)[0]
    )

    # Filter out the latest quarter if it has fewer than 50 transactions
    filtered_df = sf.df.join(
        transaction_count_df, on=["quarter_label", "cat_remaining_lease_years"]
    ).filter(
        (pl.col("quarter_label") != latest_quarter)
        | (pl.col("transaction_count") >= 50)
    )

    # Compute the quarter-on-quarter percentage change
    chart_df = (
        filtered_df.group_by(["quarter_label", "cat_remaining_lease_years"])
        .agg(pl.median("resale_price").alias("median_resale_price"))
        .sort(["cat_remaining_lease_years", "quarter_label"])
        .with_columns(
            (
                (
                    (
                        pl.col("median_resale_price")
                        - pl.col("median_resale_price").shift(1)
                    )
                    / pl.col("median_resale_price").shift(1)
                )
                * 100
            )
            .alias("percentage_change")
            .round(2)
        )
        .sort(by="quarter_label", descending=True)
        .select(["quarter_label", "cat_remaining_lease_years", "percentage_change"])
    )

    st.dataframe(chart_df)


st.markdown("### QoQ % Change in Median Price")
plot_qoq_change(sf)
