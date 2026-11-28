#!/usr/bin/env bash
# Fetch the data from the `data` GitHub Release (it isn't stored in git) and generate
# the web app's data artifacts in web/public/data/.
#
#   scripts/setup-data.sh          # what `bun run dev` needs: df.parquet + metadata
#   scripts/setup-data.sh --csv    # also the monthly CSVs, for working on the ETL
#
# Safe to re-run; it always fetches the latest release assets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="https://github.com/benjamin-awd/hdb-kaki/releases/download/data"

with_csv=false
case "${1:-}" in
  --csv) with_csv=true ;;
  "") ;;
  *) echo "usage: $0 [--csv]" >&2; exit 2 ;;
esac

command -v uv >/dev/null || { echo "uv is required: https://docs.astral.sh/uv/" >&2; exit 1; }

fetch() {
  echo "Downloading $1"
  curl -fsSL --retry 3 -o "$2" "$BASE/$1"
}

cd "$ROOT"
fetch df.parquet data/df.parquet
fetch metadata data/metadata

if $with_csv; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  fetch csv.tar.gz "$tmp"
  tar xzf "$tmp" -C "$ROOT"
  echo "Extracted $(ls data/*.csv | wc -l | tr -d ' ') monthly CSVs into data/"
fi

echo "Generating web/public/data/"
uv run --no-project --with polars --with shapely webapp/update/emit_web.py
