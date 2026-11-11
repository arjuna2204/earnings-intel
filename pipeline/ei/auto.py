"""Write the brief (and with it the call comparison) for every covered company after it reports,
so visitors never land on an empty "What changed" tab.

Default pair matches the website: latest reported quarter vs the same quarter a year earlier.
Runs daily, newest reports first, then largest companies. It stops early to stay inside limits:
  - AI: stops once month-to-date spend reaches `ai_stop_usd`, leaving the rest of the monthly
    cap for visitors who press the button themselves. Whatever is left continues next month.
  - Alpha Vantage (call transcripts, 25 free a day): only starts a company when there are enough
    requests left for both calls, keeping `av_reserve` free for visitors.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from ei.ai import budget_state
from ei.calls.extract import ANALYSIS_VERSION
from ei.calls.run import label
from ei.config import Settings
from ei.db import Db
from ei.filings.brief import VERSION as BRIEF_VERSION
from ei.jobs import _today_et

log = logging.getLogger(__name__)

AV_LIMIT = 25


def pair_for(events: list[dict[str, Any]], today: date, max_age_days: int = 120) -> tuple[str, str] | None:
    """Latest reported quarter (within `max_age_days`) and the same quarter a year earlier."""
    done = [e for e in events if e.get("report_date") and date.fromisoformat(e["report_date"]) <= today]
    if not done:
        return None
    last = max(done, key=lambda e: e["report_date"])
    if (today - date.fromisoformat(last["report_date"])).days > max_age_days:
        return None
    fy, fq = int(last["fiscal_year"]), int(last["fiscal_quarter"])
    return label(fy - 1, fq), label(fy, fq)


def av_used(db: Db) -> int:
    rows = db.select("api_usage", {"provider": "eq.alpha_vantage", "day": f"eq.{_today_et()}", "select": "requests"})
    return int(rows[0]["requests"]) if rows else 0


def queue(db: Db, today: date) -> list[dict[str, Any]]:
    """Companies whose current pair has no brief yet: newest report first, then by size."""
    companies = db.select_all("companies", {"select": "cik,ticker,cap:valuation->market_cap"})
    events = db.select_all(
        "earnings_events",
        {"report_date": f"gte.{today - timedelta(days=130)}", "select": "cik,fiscal_year,fiscal_quarter,report_date"},
    )
    briefs = db.select_all("briefs", {"version": f"eq.{BRIEF_VERSION}", "select": "cik,period_a,period_b"})
    have = {(b["cik"], b["period_a"], b["period_b"]) for b in briefs}
    by_cik: dict[int, list[dict[str, Any]]] = {}
    for e in events:
        by_cik.setdefault(e["cik"], []).append(e)
    out = []
    for c in companies:
        evs = by_cik.get(c["cik"], [])
        p = pair_for(evs, today)
        if p is None or (c["cik"], *p) in have:
            continue
        last = max(e["report_date"] for e in evs if e["report_date"] <= today.isoformat())
        out.append({**c, "a": p[0], "b": p[1], "reported": last})
    out.sort(key=lambda c: (c["reported"], float(c.get("cap") or 0)), reverse=True)
    return out


def calls_needed(db: Db, cik: int, a: str, b: str) -> int:
    """How many call transcripts still have to be fetched for this pair (0, 1 or 2)."""
    done = db.select(
        "call_comparisons",
        {
            "cik": f"eq.{cik}",
            "period_a": f"eq.{a}",
            "period_b": f"eq.{b}",
            "analysis_version": f"eq.{ANALYSIS_VERSION}",
            "select": "cik",
        },
    )
    if done:
        return 0
    rows = db.select(
        "call_analysis",
        {"cik": f"eq.{cik}", "analysis_version": f"eq.{ANALYSIS_VERSION}", "select": "fiscal_year,fiscal_quarter"},
    )
    have = {label(int(r["fiscal_year"]), int(r["fiscal_quarter"])) for r in rows}
    return sum(1 for q in (a, b) if q not in have)


def run(settings: Settings, max_companies: int = 15, ai_stop_usd: float = 7.0, av_reserve: int = 6) -> dict[str, Any]:
    from ei.filings.run import run_brief

    db = Db(settings.supabase_url, settings.supabase_secret_key)
    today = _today_et()
    todo = queue(db, today)
    done: list[str] = []
    skipped: list[str] = []
    stop = None
    for c in todo:
        if len(done) >= max_companies:
            stop = f"daily limit of {max_companies} companies"
            break
        if float(budget_state(db).spent_usd) >= ai_stop_usd:
            stop = f"AI spend reached ${ai_stop_usd:.2f} this month; continues next month"
            break
        need = calls_needed(db, c["cik"], c["a"], c["b"])
        if need and av_used(db) + need > AV_LIMIT - av_reserve:
            skipped.append(f"{c['ticker']} (waiting for call transcripts)")
            continue
        res = run_brief(settings, c["ticker"], c["a"], c["b"])
        (done if res.get("ok") else skipped).append(
            c["ticker"] if res.get("ok") else f"{c['ticker']} ({str(res.get('error'))[:80]})"
        )
    return {"queue": len(todo), "written": done, "skipped": skipped, "stopped": stop}
