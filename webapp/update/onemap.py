"""Shared OneMap auth. Stdlib-only so the ``uv run --no-project`` build scripts can import it."""

import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def onemap_token() -> str:
    """Mint a OneMap token from ONEMAP_EMAIL/ONEMAP_PASSWORD (env, or web/.dev.vars for local
    builds). OneMap Search rejects anonymous requests with 401, so every caller needs one. In CI,
    provide the two values as secrets."""
    email, password = os.environ.get("ONEMAP_EMAIL"), os.environ.get("ONEMAP_PASSWORD")
    dev = ROOT / "web" / ".dev.vars"
    if not (email and password) and dev.exists():
        vals = dict(
            line.split("=", 1)
            for line in dev.read_text().splitlines()
            if "=" in line and not line.lstrip().startswith("#")
        )
        email = email or vals.get("ONEMAP_EMAIL", "").strip()
        password = password or vals.get("ONEMAP_PASSWORD", "").strip()
    if not (email and password):
        raise SystemExit("Set ONEMAP_EMAIL / ONEMAP_PASSWORD (or web/.dev.vars) to geocode.")
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        "https://www.onemap.gov.sg/api/auth/post/getToken",
        data=body,
        headers={"content-type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=30))["access_token"]
