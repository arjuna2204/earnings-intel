"""Macro data from FRED (Federal Reserve Bank of St. Louis): free CSV downloads, no API key.

Daily, each series' recent history is re-downloaded (they are small) and upserted. Revised values
overwrite older ones, so charts always show FRED's current numbers.
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import date, timedelta
from typing import Any

import httpx

from ei.db import Db
from ei.http import RateLimiter, get_with_retries

log = logging.getLogger(__name__)
URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
SERIES = [
    "DGS10",  # 10-year Treasury yield
    "DGS2",  # 2-year Treasury yield
    "T10Y2Y",  # yield curve: 10-year minus 2-year
    "DFF",  # fed funds rate
    "CPIAUCSL",  # consumer prices (index)
    "CPILFESL",  # core consumer prices (index)
    "UNRATE",  # unemployment rate
    "PAYEMS",  # nonfarm payrolls (thousands)
    "A191RL1Q225SBEA",  # real GDP growth, annualized
    "BAMLH0A0HYM2",  # high-yield credit spread
    "DCOILWTICO",  # WTI crude oil
    "MORTGAGE30US",  # 30-year mortgage rate
    "UMCSENT",  # consumer sentiment
    "VIXCLS",  # VIX
]


def fetch(client: httpx.Client, series: str, since: date, limiter: RateLimiter) -> list[dict[str, Any]]:
    r = get_with_retries(client, URL, params={"id": series, "cosd": since.isoformat()}, limiter=limiter)
    r.raise_for_status()
    rows = []
    for rec in csv.reader(io.StringIO(r.text)):
        if len(rec) < 2 or rec[0] in ("DATE", "observation_date") or rec[1] in (".", ""):
            continue
        try:
            rows.append({"series": series, "date": rec[0], "value": float(rec[1])})
        except ValueError:
            continue
    return rows


def run(db: Db, years: int = 20) -> dict[str, Any]:
    since = date.today() - timedelta(days=365 * years)
    out: dict[str, Any] = {}
    limiter = RateLimiter(rate=2)
    with httpx.Client(timeout=60, headers={"User-Agent": "earnings-intel research tool"}, follow_redirects=True) as c:
        for s in SERIES:
            try:
                rows = fetch(c, s, since, limiter)
                for i in range(0, len(rows), 1000):
                    db.upsert("macro_series", rows[i : i + 1000], on_conflict="series,date")
                out[s] = len(rows)
            except Exception as exc:
                out[s] = f"error: {exc}"[:100]
    return out
