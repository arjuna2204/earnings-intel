"""Post-earnings recaps, computed in code each morning (no AI, no paid data).

Before a report (up to 3 days ahead) the expectations are saved, because the options snapshot moves
on to the next report once this one passes: the EPS estimate and, for researched companies, the
options-implied earnings-day move. After the report:

- EPS vs estimate: Street EPS (Alpha Vantage, researched companies only) once it is in.
- Stock reaction: close before the report date → close of the first trading day after it. This
  two-session window covers both before-the-open and after-the-close reports.
- Revenue: the quarter from the 10-Q/10-K, once filed, and its growth vs a year earlier.
- Guidance: counts from the call comparison, if the call has been analyzed since the report.

A recap is final once the reaction is known and either EPS is in or 10 days have passed.
"""

from __future__ import annotations

import logging
from bisect import bisect_left, bisect_right
from datetime import date, datetime, timedelta
from typing import Any

from ei.db import Db

log = logging.getLogger(__name__)

AHEAD_DAYS = 3
BACK_DAYS = 14


def reaction(closes: list[tuple[str, float]], report_date: str) -> tuple[float, str, str] | None:
    """(move, from-date, to-date): last close before `report_date` → first close after it."""
    if not closes:
        return None
    days = [d for d, _ in closes]
    i = bisect_left(days, report_date) - 1  # last session strictly before the report date
    j = bisect_right(days, report_date)  # first session strictly after it
    if i < 0 or j >= len(closes) or closes[i][1] <= 0:
        return None
    return closes[j][1] / closes[i][1] - 1, closes[i][0], closes[j][0]


def surprise(actual: float | None, est: float | None) -> float | None:
    if actual is None or est is None or est == 0:
        return None
    return (actual - est) / abs(est)


def _closes_researched(db: Db, ticker: str, since: str) -> list[tuple[str, float]]:
    rows = db.select(
        "prices", {"ticker": f"eq.{ticker}", "date": f"gte.{since}", "select": "date,adj_close", "order": "date.asc"}
    )
    return [(r["date"], float(r["adj_close"])) for r in rows]


def run(db: Db, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    t = today.isoformat()
    researched = {c["ticker"]: c for c in db.select("companies", {"select": "cik,ticker,name"})}
    lite = {r["ticker"]: r for r in db.select_all("lite_companies", {"select": "cik,ticker,name,history"})}
    opts = {
        r["cik"]: r
        for r in db.select(
            "options_snapshot", {"select": "cik,move:result->earnings->day_move,edate:result->earnings->>date"}
        )
    }

    # 1. expectations for reports in the next few days
    ahead = db.select_all(
        "earnings_calendar",
        {
            "report_date": f"gte.{t}",
            "and": f"(report_date.lte.{(today + timedelta(days=AHEAD_DAYS)).isoformat()})",
            "select": "ticker,report_date,eps_estimate",
        },
    )
    expect: list[dict[str, Any]] = []
    for e in ahead:
        c = researched.get(e["ticker"]) or lite.get(e["ticker"])
        if not c:
            continue
        o = opts.get(c["cik"]) if e["ticker"] in researched else None
        expect.append(
            {
                "ticker": e["ticker"],
                "report_date": e["report_date"],
                "cik": c["cik"],
                "name": c["name"],
                "researched": e["ticker"] in researched,
                "eps_estimate": e["eps_estimate"],
                "expected_move": o["move"] if o and o.get("edate") == e["report_date"] else None,
            }
        )
    if expect:
        db.upsert("earnings_recaps", expect, on_conflict="ticker,report_date")

    # researched companies whose report is already in Alpha Vantage's history also get a recap
    since = (today - timedelta(days=BACK_DAYS)).isoformat()
    events = db.select(
        "earnings_events",
        {
            "report_date": f"gte.{since}",
            "select": "cik,report_date,eps_reported,eps_estimated,fiscal_year,fiscal_quarter",
        },
    )
    by_cik = {c["cik"]: c for c in researched.values()}
    seed = [
        {
            "ticker": by_cik[ev["cik"]]["ticker"],
            "report_date": ev["report_date"],
            "cik": ev["cik"],
            "name": by_cik[ev["cik"]]["name"],
            "researched": True,
        }
        for ev in events
        if ev["cik"] in by_cik and ev["report_date"] < t
    ]
    if seed:
        db.upsert("earnings_recaps", seed, on_conflict="ticker,report_date")

    # 2. recaps for reports in the last two weeks that aren't final yet
    pending = db.select(
        "earnings_recaps",
        {"report_date": f"gte.{since}", "and": f"(report_date.lt.{t})", "final": "is.false", "select": "*"},
    )
    ev_by = {(e["cik"], e["report_date"]): e for e in events}
    done = 0
    for r in pending:
        tk, rd, cik = r["ticker"], r["report_date"], r["cik"]
        start = (date.fromisoformat(rd) - timedelta(days=10)).isoformat()
        if r["researched"]:
            closes = _closes_researched(db, tk, start)
        else:
            closes = [(str(d), float(c)) for d, c in (lite.get(tk) or {}).get("history") or [] if str(d) >= start]
        react = reaction(closes, rd)
        ev = ev_by.get((cik, rd))
        actual = ev["eps_reported"] if ev else None
        est = (ev["eps_estimated"] if ev and ev.get("eps_estimated") is not None else None) or r.get("eps_estimate")
        upd: dict[str, Any] = {
            "ticker": tk,
            "report_date": rd,
            "eps_actual": actual,
            "eps_estimate": est,
            "eps_surprise": surprise(actual, est),
            "move": react[0] if react else None,
            "move_from": react[1] if react else None,
            "move_to": react[2] if react else None,
            "computed_at": datetime.now().isoformat(),
        }
        if r["researched"]:
            # revenue for the quarter, once the 10-Q/10-K is in (filed on or after the report date)
            q = db.select(
                "metric_values",
                {
                    "cik": f"eq.{cik}",
                    "metric": "in.(revenue,revenue_growth_yoy)",
                    "fiscal_period": "neq.FY",
                    "period_end": f"gte.{(date.fromisoformat(rd) - timedelta(days=75)).isoformat()}",
                    "and": f"(period_end.lt.{rd})",
                    "select": "metric,fiscal_year,fiscal_period,value",
                },
            )
            rev = next((x for x in q if x["metric"] == "revenue"), None)
            g = next((x for x in q if x["metric"] == "revenue_growth_yoy"), None)
            upd["revenue"] = rev["value"] if rev else None
            upd["revenue_growth"] = g["value"] if g else None
            upd["quarter"] = f"{rev['fiscal_period']} FY{rev['fiscal_year']}" if rev else None
            cmp = db.select(
                "call_comparisons",
                {
                    "cik": f"eq.{cik}",
                    "created_at": f"gte.{rd}",
                    "select": "result->guidance",
                    "order": "created_at.desc",
                    "limit": "1",
                },
            )
            gl = (cmp[0].get("guidance") or []) if cmp else []
            if gl:
                upd["guidance"] = {
                    "raised": sum(1 for x in gl if x.get("change") == "raised"),
                    "lowered": sum(1 for x in gl if x.get("change") in ("lowered", "withdrawn")),
                    "maintained": sum(1 for x in gl if x.get("change") in ("maintained", "reaffirmed")),
                }
        age = (today - date.fromisoformat(rd)).days
        upd["final"] = bool(react) and (actual is not None or not r["researched"] or age >= 10) and age >= 2
        db.upsert("earnings_recaps", [upd], on_conflict="ticker,report_date")
        done += 1
    return {"expectations": len(expect), "seeded": len(seed), "recaps_updated": done}
