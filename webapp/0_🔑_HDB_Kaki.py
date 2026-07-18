import streamlit as st

from webapp.logo import logo

NEW_URL = "https://app.hdb-kaki.workers.dev"

st.set_page_config(page_title="HDB Kaki has moved", page_icon="🔑", layout="centered")

st.markdown(
    f'<div style="display:flex;justify-content:center;margin-bottom:1rem">{logo}</div>',
    unsafe_allow_html=True,
)

st.markdown("## HDB Kaki has a new home")
st.markdown(
    "This Streamlit app has been retired. HDB Kaki has been rebuilt from the "
    f"ground up — it's faster and fully redesigned at **[{NEW_URL}]({NEW_URL})**."
)

st.link_button("Go to the new HDB Kaki  →", NEW_URL, type="primary")

st.caption(
    "Please update your bookmarks. This page will no longer be updated with new data."
)
