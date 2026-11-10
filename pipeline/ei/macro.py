"""Macro data from official public sources, keyless:

- US Treasury: daily par yield curve (10-year, 2-year; the curve is their difference)
- New York Fed: effective federal funds rate
- Bureau of Labor Statistics (public API v1): CPI, core CPI, unemployment, payrolls
- Cboe: VIX history
- FRED (St. Louis Fed) API for the rest (GDP, credit spreads, oil, mortgage rates, sentiment) — only
  when a free FRED_API_KEY is configured in the repository's secrets; otherwise those are skipped.

Each source has short timeouts and its failure skips only that source.
"""

from __future__ import annotations

import csv
import io
import logging
import os
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from ei.db import Db

log = logging.getLogger(__name__)
UA = {"User-Agent": "earnings-intel research tool (github.com)"}
TIMEOUT = httpx.Timeout(30, connect=10)

BLS = {"CUSR0000SA0": "CPIAUCSL", "CUSR0000SA0L1E": "CPILFESL", "LNS14000000": "UNRATE", "CES0000000001": "PAYEMS"}
FRED_ONLY = ["A191RL1Q225SBEA", "BAMLH0A0HYM2", "DCOILWTICO", "MORTGAGE30US", "UMCSENT"]


def treasury(c: httpx.Client, years: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for y in range(date.today().year - years, date.today().year + 1):
        url = (
            "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
            f"{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv"
        )
        r = c.get(url)
        r.raise_for_status()
        for rec in csv.DictReader(io.StringIO(r.text)):
            try:
                d = datetime.strptime(rec["Date"], "%m/%d/%Y").date().isoformat()
                ten, two = float(rec["10 Yr"]), float(rec["2 Yr"])
            except (KeyError, ValueError):
                continue
            rows += [
                {"series": "DGS10", "date": d, "value": ten},
                {"series": "DGS2", "date": d, "value": two},
                {"series": "T10Y2Y", "date": d, "value": round(ten - two, 4)},
            ]
    return rows


def nyfed_effr(c: httpx.Client, since: date) -> list[dict[str, Any]]:
    r = c.get(
        "https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json",
        params={"startDate": since.isoformat(), "endDate": date.today().isoformat()},
    )
    r.raise_for_status()
    return [
        {"series": "DFF", "date": x["effectiveDate"], "value": float(x["percentRate"])}
        for x in r.json().get("refRates", [])
        if x.get("percentRate") is not None
    ]


def bls(c: httpx.Client, years: int) -> list[dict[str, Any]]:
    end = date.today().year
    r = c.post(
        "https://api.bls.gov/publicAPI/v1/timeseries/data/",
        json={"seriesid": list(BLS), "startyear": str(end - min(years, 9)), "endyear": str(end)},
    )
    r.raise_for_status()
    rows = []
    for s in r.json().get("Results", {}).get("series", []):
        sid = BLS.get(s.get("seriesID", ""))
        for x in s.get("data", []):
            if not sid or not str(x.get("period", "")).startswith("M") or x["period"] == "M13":
                continue
            try:
                rows.append({"series": sid, "date": f"{x['year']}-{x['period'][1:]}-01", "value": float(x["value"])})
            except (KeyError, ValueError):
                continue
    return rows


def vix(c: httpx.Client, since: date) -> list[dict[str, Any]]:
    r = c.get("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv")
    r.raise_for_status()
    rows = []
    for rec in csv.DictReader(io.StringIO(r.text)):
        try:
            d = datetime.strptime(rec["DATE"], "%m/%d/%Y").date()
            if d >= since:
                rows.append({"series": "VIXCLS", "date": d.isoformat(), "value": float(rec["CLOSE"])})
        except (KeyError, ValueError):
            continue
    return rows


def fred(c: httpx.Client, key: str, series: str, since: date) -> list[dict[str, Any]]:
    r = c.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={"series_id": series, "api_key": key, "file_type": "json", "observation_start": since.isoformat()},
    )
    r.raise_for_status()
    return [
        {"series": series, "date": o["date"], "value": float(o["value"])}
        for o in r.json().get("observations", [])
        if o.get("value") not in (".", None, "")
    ]


def run(db: Db, years: int = 6) -> dict[str, Any]:
    since = date.today() - timedelta(days=365 * years)
    out: dict[str, Any] = {}
    key = os.environ.get("FRED_API_KEY", "")
    sources: list[tuple[str, Any]] = [
        ("treasury", lambda c: treasury(c, years)),
        ("nyfed", lambda c: nyfed_effr(c, since)),
        ("bls", lambda c: bls(c, years)),
        ("cboe_vix", lambda c: vix(c, since)),
    ]
    if key:
        sources += [(f"fred:{s}", lambda c, s=s: fred(c, key, s, since)) for s in FRED_ONLY]
    else:
        out["fred"] = (
            "skipped: add a free FRED_API_KEY secret for GDP, credit spreads, oil, mortgage rates and sentiment"
        )
    with httpx.Client(timeout=TIMEOUT, headers=UA, follow_redirects=True) as c:
        for name, fn in sources:
            try:
                rows = fn(c)
                for i in range(0, len(rows), 1000):
                    db.upsert("macro_series", rows[i : i + 1000], on_conflict="series,date")
                out[name] = len(rows)
            except Exception as exc:
                out[name] = f"error: {type(exc).__name__}: {exc}"[:160]
    return out
