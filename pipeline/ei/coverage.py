"""Daily Alpha Vantage coverage, biggest companies first (25 free requests/day).

For each loaded company in market-cap order:
  1. earnings history (beat/miss) and analyst estimates, when missing or stale — 1 request each;
  2. the latest quarter's call transcript, once (no year-ago transcript: comparisons pull that only when
     someone asks), plus the AI read of that one call (~$0.004).
A small reserve is kept for comparisons people start themselves. Whatever is left goes to the backtest.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from ei.ai import AiClient
from ei.calls.extract import ANALYSIS_VERSION
from ei.calls.run import AvQuota, analyze_call, ensure_estimates, ensure_events, estimates_stale
from ei.db import Db
from ei.jobs import _today_et, latest_price
from ei.transcripts import AlphaVantageProvider, QuotaReached

log = logging.getLogger(__name__)

USER_RESERVE = 2  # requests kept back each day for comparisons people start
MISS_RETRY_DAYS = 14  # provider had no transcript: look again after two weeks


def ordered_companies(db: Db) -> list[dict[str, Any]]:
    etfs = {r["sector_etf"] for r in db.select("companies", {"select": "sector_etf"}) if r.get("sector_etf")} | {"SPY"}
    comps = [c for c in db.select("companies", {"select": "*"}) if c["ticker"] not in etfs]
    rank = {int(r["cik"]): int(r["rank"]) for r in db.select("universe", {"select": "cik,rank", "limit": "5000"})}

    def key(c: dict[str, Any]) -> tuple[int, float]:
        cap = (c.get("valuation") or {}).get("market_cap") or 0
        return (rank.get(int(c["cik"]), 10**6), -cap)

    return sorted(comps, key=key)


# transcript_misses rows with fiscal_year 0 mark "the provider had no Street data" (quarter 0 = earnings
# history, 1 = estimates), so companies the provider doesn't cover aren't re-requested every day
def _recent_miss(db: Db, cik: int, fy: int, fq: int, days: int = MISS_RETRY_DAYS) -> bool:
    m = db.select(
        "transcript_misses",
        {"cik": f"eq.{cik}", "fiscal_year": f"eq.{fy}", "fiscal_quarter": f"eq.{fq}", "select": "checked_at"},
    )
    return bool(m) and (_today_et() - date.fromisoformat(str(m[0]["checked_at"])[:10])) < timedelta(days=days)


def _mark_miss(db: Db, cik: int, fy: int, fq: int) -> None:
    db.upsert(
        "transcript_misses",
        [{"cik": cik, "fiscal_year": fy, "fiscal_quarter": fq, "checked_at": _today_et().isoformat()}],
        on_conflict="cik,fiscal_year,fiscal_quarter",
    )


def needs_street(db: Db, c: dict[str, Any]) -> tuple[bool, bool]:
    cik = c["cik"]
    ev = db.select(
        "earnings_events", {"cik": f"eq.{cik}", "select": "report_date", "order": "report_date.desc", "limit": "1"}
    )
    # fetch earnings history only once a new report should be in it: the calendar's last (or a passed)
    # report date is after our newest event. Companies the calendar doesn't list: about a quarter later.
    today = _today_et()
    last = date.fromisoformat(str(ev[0]["report_date"])[:10]) if ev else None
    cal = db.select("earnings_calendar", {"ticker": f"eq.{c['ticker']}", "select": "report_date,last_report_date"})
    expected = None
    if cal:
        passed = [
            str(cal[0][k])[:10]
            for k in ("report_date", "last_report_date")
            if cal[0].get(k) and str(cal[0][k])[:10] < today.isoformat()
        ]
        expected = date.fromisoformat(max(passed)) if passed else None
    if last is None:
        events_needed = True
    elif cal:
        events_needed = expected is not None and last < expected - timedelta(days=3)
    else:
        events_needed = (today - last).days >= 100
    est = db.select(
        "eps_estimates", {"cik": f"eq.{cik}", "select": "fetched_at", "order": "fetched_at.desc", "limit": "1"}
    )
    estimates_needed = not est or estimates_stale(db, c, date.fromisoformat(str(est[0]["fetched_at"])[:10]))
    return (
        events_needed and not _recent_miss(db, cik, 0, 0, days=3),
        estimates_needed and not _recent_miss(db, cik, 0, 1),
    )


def run(settings: Any, max_companies: int = 500) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    av = AlphaVantageProvider(
        settings.alpha_vantage_api_key, quota_check=AvQuota(db, AlphaVantageProvider.daily_limit, reserve=USER_RESERVE)
    )
    ai = AiClient(settings.anthropic_api_key, db) if settings.anthropic_api_key else None
    report: dict[str, list[str]] = {"street": [], "calls": [], "no_transcript": [], "errors": []}
    try:
        for c in ordered_companies(db)[:max_companies]:
            cik = c["cik"]
            try:
                ev_need, est_need = needs_street(db, c)
                if ev_need:
                    before = db.select(
                        "earnings_events",
                        {"cik": f"eq.{cik}", "select": "report_date", "order": "report_date.desc", "limit": "1"},
                    )
                    after = ensure_events(db, av, c)
                    newest = max((str(r["report_date"]) for r in after), default=None)
                    if not after or (before and newest == str(before[0]["report_date"])):
                        _mark_miss(db, cik, 0, 0)  # nothing new yet: look again in 3 days
                if est_need and not ensure_estimates(db, av, c):
                    _mark_miss(db, cik, 0, 1)
                if ev_need or est_need:
                    _update_street(settings, db, c)
                    report["street"].append(c["ticker"])
                # latest reported quarter's call, once
                last = db.select(
                    "earnings_events",
                    {
                        "cik": f"eq.{cik}",
                        "report_date": f"lte.{_today_et()}",
                        "select": "*",
                        "order": "report_date.desc",
                        "limit": "1",
                    },
                )
                if not last:
                    continue
                e = last[0]
                fy, fq = int(e["fiscal_year"]), int(e["fiscal_quarter"])
                done = db.select(
                    "call_analysis",
                    {
                        "cik": f"eq.{cik}",
                        "fiscal_year": f"eq.{fy}",
                        "fiscal_quarter": f"eq.{fq}",
                        "analysis_version": f"eq.{ANALYSIS_VERSION}",
                        "status": "eq.done",
                        "select": "cik",
                    },
                )
                if done:
                    continue
                miss = db.select(
                    "transcript_misses",
                    {
                        "cik": f"eq.{cik}",
                        "fiscal_year": f"eq.{fy}",
                        "fiscal_quarter": f"eq.{fq}",
                        "select": "checked_at",
                    },
                )
                if miss and (_today_et() - date.fromisoformat(str(miss[0]["checked_at"])[:10])) < timedelta(
                    days=MISS_RETRY_DAYS
                ):
                    continue
                try:
                    analyze_call(db, av, ai, c, fy, fq, e)
                    report["calls"].append(f"{c['ticker']} FY{fy}Q{fq}")
                except LookupError:
                    db.upsert(
                        "transcript_misses",
                        [{"cik": cik, "fiscal_year": fy, "fiscal_quarter": fq, "checked_at": _today_et().isoformat()}],
                        on_conflict="cik,fiscal_year,fiscal_quarter",
                    )
                    report["no_transcript"].append(c["ticker"])
            except QuotaReached:
                raise
            except Exception as ex:  # one company's odd data shouldn't stop the run
                log.warning("coverage %s: %s", c["ticker"], ex)
                report["errors"].append(f"{c['ticker']}: {type(ex).__name__}")
    except QuotaReached:
        report["stopped"] = ["daily Alpha Vantage allowance used"]
    finally:
        av.close()
    return report


def _update_street(settings: Any, db: Db, c: dict[str, Any]) -> None:
    """Recompute Street multiples (adjusted / forward P/E) from stored data into the valuation snapshot."""
    from ei.street import street_multiples

    price, _ = latest_price(db, c["ticker"])
    if price is None:
        return
    events = db.select("earnings_events", {"cik": f"eq.{c['cik']}", "select": "*"})
    estimates = db.select("eps_estimates", {"cik": f"eq.{c['cik']}", "select": "*"})
    v = dict(c.get("valuation") or {})
    v.update(street_multiples(price, events, estimates, _today_et()))
    db.update("companies", {"cik": c["cik"]}, {"valuation": v})
