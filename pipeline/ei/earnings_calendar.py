"""Upcoming earnings dates for all US tickers (Alpha Vantage EARNINGS_CALENDAR: 1 request/day)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from ei.calls.run import AvQuota
from ei.db import Db
from ei.transcripts import AlphaVantageProvider


def refresh(settings: Any) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    av = AlphaVantageProvider(settings.alpha_vantage_api_key, quota_check=AvQuota(db, AlphaVantageProvider.daily_limit))
    try:
        rows = av.earnings_calendar()
    finally:
        av.close()
    # one row per ticker: the soonest upcoming date
    soonest: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r["ticker"] not in soonest or r["report_date"] < soonest[r["ticker"]]["report_date"]:
            soonest[r["ticker"]] = r
    if not soonest:
        return {"rows": 0}
    # when a company's date moves forward, remember the one that just passed
    today = date.today().isoformat()
    existing: dict[str, dict[str, Any]] = {}
    start = 0
    while True:
        page = db.select(
            "earnings_calendar",
            {"select": "ticker,report_date,last_report_date", "order": "ticker", "offset": str(start), "limit": "1000"},
        )
        existing.update({r["ticker"]: r for r in page})
        if len(page) < 1000:
            break
        start += 1000
    for t, r in soonest.items():
        old = existing.get(t)
        if old and str(old["report_date"]) < r["report_date"] and str(old["report_date"]) <= today:
            r["last_report_date"] = str(old["report_date"])
        elif old:
            r["last_report_date"] = old.get("last_report_date")
    db.delete_where("earnings_calendar", {"report_date": f"lt.{(date.today() - timedelta(days=120)).isoformat()}"})
    n = db.upsert("earnings_calendar", list(soonest.values()), on_conflict="ticker")
    return {"rows": n}
