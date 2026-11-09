"""Upcoming earnings dates for all US tickers (Alpha Vantage EARNINGS_CALENDAR: 1 request/day)."""

from __future__ import annotations

from datetime import date
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
    db.delete_where("earnings_calendar", {"report_date": f"lt.{date.today().isoformat()}"})
    n = db.upsert("earnings_calendar", list(soonest.values()), on_conflict="ticker")
    return {"rows": n}
