"""Short interest from FINRA (free, public, no key): shares sold short, twice a month, per stock.

FINRA publishes consolidated short interest for every US-listed stock as of the 15th and the last
business day of each month (released about a week later). One request covers all our tickers.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import httpx

from ei.db import Db

log = logging.getLogger(__name__)
URL = "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"


def fetch(tickers: list[str], since: date) -> list[dict[str, Any]]:
    body = {
        "limit": 5000,
        "domainFilters": [{"fieldName": "symbolCode", "values": tickers}],
        "dateRangeFilters": [
            {"fieldName": "settlementDate", "startDate": since.isoformat(), "endDate": date.today().isoformat()}
        ],
        "fields": [
            "settlementDate",
            "symbolCode",
            "currentShortPositionQuantity",
            "averageDailyVolumeQuantity",
            "daysToCoverQuantity",
        ],
    }
    with httpx.Client(
        timeout=60, headers={"Accept": "application/json", "User-Agent": "earnings-intel research tool"}
    ) as c:
        r = c.post(URL, json=body)
        r.raise_for_status()
        data = r.json()
    return data if isinstance(data, list) else []


def to_rows(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for x in raw:
        try:
            out.append(
                {
                    "ticker": str(x["symbolCode"]).upper(),
                    "settlement_date": str(x["settlementDate"])[:10],
                    "short_shares": float(x["currentShortPositionQuantity"]),
                    "avg_daily_volume": float(x["averageDailyVolumeQuantity"])
                    if x.get("averageDailyVolumeQuantity") is not None
                    else None,
                    "days_to_cover": float(x["daysToCoverQuantity"])
                    if x.get("daysToCoverQuantity") is not None
                    else None,
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    return out


def run(db: Db, days: int = 400) -> dict[str, Any]:
    tickers = [c["ticker"] for c in db.select("companies", {"select": "ticker"})]
    tickers += [c["ticker"] for c in db.select_all("lite_companies", {"select": "ticker"})]
    tickers = sorted({t.replace("-", ".") for t in tickers})
    since = date.today() - timedelta(days=days)
    rows: list[dict[str, Any]] = []
    for i in range(0, len(tickers), 100):
        try:
            rows += to_rows(fetch(tickers[i : i + 100], since))
        except Exception as exc:
            log.warning("FINRA short interest failed: %s", exc)
            return {"error": f"{type(exc).__name__}: {exc}"[:200], "rows": len(rows)}
    for r in rows:
        r["ticker"] = r["ticker"].replace(".", "-")
    for i in range(0, len(rows), 500):
        db.upsert("short_interest", rows[i : i + 500], on_conflict="ticker,settlement_date")
    latest = max((r["settlement_date"] for r in rows), default=None)
    return {"rows": len(rows), "tickers": len({r["ticker"] for r in rows}), "latest": latest}
