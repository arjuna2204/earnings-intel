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


def latest_quarters(rows: list[dict[str, Any]]) -> dict[int, tuple[int, int, str]]:
    """Newest filed quarter per company from metric rows: cik -> (fiscal year, quarter, period end).
    A fiscal-year row stands for Q4."""
    out: dict[int, tuple[int, int, str]] = {}
    for r in rows:
        fp = r["fiscal_period"]
        q = 4 if fp == "FY" else int(fp[1]) if fp in ("Q1", "Q2", "Q3", "Q4") else None
        if q is None:
            continue
        cur = out.get(r["cik"])
        if cur is None or r["period_end"] > cur[2]:
            out[r["cik"]] = (int(r["fiscal_year"]), q, r["period_end"])
    return out


def queue(db: Db, today: date) -> list[dict[str, Any]]:
    """Companies whose newest filed quarter has no brief yet: newest quarter first, then by size."""
    companies = db.select_all("companies", {"select": "cik,ticker,cap:valuation->market_cap"})
    rows = db.select_all(
        "metric_values",
        {
            "metric": "eq.net_income",
            "period_end": f"gte.{today - timedelta(days=150)}",
            "select": "cik,fiscal_year,fiscal_period,period_end",
        },
    )
    latest = latest_quarters(rows)
    briefs = db.select_all("briefs", {"version": f"eq.{BRIEF_VERSION}", "select": "cik,period_a,period_b"})
    have = {(b["cik"], b["period_a"], b["period_b"]) for b in briefs}
    out = []
    for c in companies:
        if c["cik"] not in latest:
            continue
        fy, fq, end = latest[c["cik"]]
        a, b = label(fy - 1, fq), label(fy, fq)
        if (c["cik"], a, b) in have:
            continue
        out.append({**c, "a": a, "b": b, "reported": end})
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
        # Fetch the two call transcripts only if the free daily allowance can spare them; otherwise
        # write the brief from filings and numbers now, and the call comparison follows on a later day.
        need = calls_needed(db, c["cik"], c["a"], c["b"])
        skip_calls = bool(need) and av_used(db) + need > AV_LIMIT - av_reserve
        res = run_brief(settings, c["ticker"], c["a"], c["b"], skip_calls=skip_calls)
        (done if res.get("ok") else skipped).append(
            c["ticker"] if res.get("ok") else f"{c['ticker']} ({str(res.get('error'))[:80]})"
        )
    calls = catch_up_calls(db, settings, today, av_reserve)
    return {"queue": len(todo), "written": done, "skipped": skipped, "stopped": stop, "calls": calls}


def catch_up_calls(db: Db, settings: Settings, today: date, av_reserve: int) -> list[str]:
    """Briefs written without the call: add the call comparison while transcript requests last."""
    from ei.calls.run import compare_calls

    briefs = db.select_all(
        "briefs",
        {
            "version": f"eq.{BRIEF_VERSION}",
            "created_at": f"gte.{today - timedelta(days=120)}",
            "select": "cik,period_a,period_b",
        },
    )
    tick = {c["cik"]: c["ticker"] for c in db.select_all("companies", {"select": "cik,ticker"})}
    out: list[str] = []
    for b in sorted(briefs, key=lambda r: r["period_b"], reverse=True):
        if b["cik"] not in tick:
            continue
        need = calls_needed(db, b["cik"], b["period_a"], b["period_b"])
        if not need:
            continue
        if av_used(db) + need > AV_LIMIT - av_reserve:
            break
        try:
            compare_calls(settings, tick[b["cik"]], b["period_a"], b["period_b"])
            out.append(tick[b["cik"]])
        except Exception as e:  # missing transcript etc.; try again another day
            log.warning("call comparison for %s failed: %s", tick[b["cik"]], e)
    return out
