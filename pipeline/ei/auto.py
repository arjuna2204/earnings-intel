"""Write the brief (and with it the call comparison) for every covered company after it reports,
so visitors never land on an empty "What changed" tab.

Default pair matches the website: latest reported quarter vs the same quarter a year earlier.
Runs daily, newest reports first, then largest companies. It stops early to stay inside limits:
  - AI: stops once month-to-date spend reaches `ai_stop_usd`, leaving the rest of the monthly
    cap for visitors who press the button themselves. Whatever is left continues next month.
  - Alpha Vantage (call transcripts, 25 free a day): only starts a company when there are enough
    requests left for both calls, keeping `av_reserve` free for visitors.

AI calls here go through the Batches API at half price (see ei.ai). A batch can take a few minutes,
so several companies run side by side to overlap the waiting; every rate limiter then allows only
its share (EI_RATE_SHARE), so SEC, Alpha Vantage and the price feeds see the same pace as before.
"""

from __future__ import annotations

import logging
import multiprocessing as mp
import os
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from ei.ai import BATCH_ENV, BATCH_WAIT_ENV, budget_state
from ei.calls.extract import ANALYSIS_VERSION
from ei.calls.run import label
from ei.config import Settings
from ei.db import Db
from ei.filings.brief import VERSION as BRIEF_VERSION
from ei.http import RATE_SHARE_ENV
from ei.jobs import _today_et

log = logging.getLogger(__name__)

AV_LIMIT = 25
# One company may take at most this long. A filing the parser cannot finish (Berkshire's very
# large 10-K hung every run from Nov 12) is skipped and parked for PARK_DAYS so the rest go ahead.
COMPANY_TIMEOUT_S = 8 * 60
PARK_DAYS = 14
PARK_KEY = "auto_research_parked"
# Batch mode: companies at once, the longest one batch may take before a normal call is made, and
# a per-company limit that leaves room for batch waits. A timeout may be a slow batch rather than a
# stuck filing, so it parks the company for days, not weeks.
# A one-request batch took about 2 minutes in testing, so a new company (about 8 calls) needs ~15.
# No company starts after LAUNCH_UNTIL_S, so the run ends within LAUNCH_UNTIL_S + the company limit.
WORKERS = 6
BATCH_WAIT_S = 240
BATCH_COMPANY_TIMEOUT_S = 30 * 60
BATCH_PARK_DAYS = 3
LAUNCH_UNTIL_S = 40 * 60


def _brief_worker(settings: Settings, ticker: str, a: str, b: str, skip_calls: bool, out: Any) -> None:
    from ei.filings.run import run_brief

    try:
        out.put(run_brief(settings, ticker, a, b, skip_calls=skip_calls))
    except Exception as e:  # report, don't crash the parent
        out.put({"ok": False, "error": f"{type(e).__name__}: {e}"})


@dataclass
class Running:
    company: dict[str, Any]
    proc: Any
    out: Any
    started: float
    calls: int  # transcript requests reserved for this company


def start_brief(settings: Settings, ticker: str, a: str, b: str, skip_calls: bool) -> tuple[Any, Any]:
    """run_brief in a child process (a stuck parse can't be interrupted in-process)."""
    ctx = mp.get_context("fork")
    out = ctx.Queue()
    p = ctx.Process(target=_brief_worker, args=(settings, ticker, a, b, skip_calls, out), daemon=True)
    p.start()
    return p, out


def stop(p: Any) -> None:
    p.terminate()
    p.join(10)
    if p.is_alive():
        p.kill()


def result_of(p: Any, out: Any) -> dict[str, Any]:
    try:
        return dict(out.get(timeout=5))
    except Exception:
        return {"ok": False, "error": f"stopped without a result (exit code {p.exitcode})"}


def brief_with_timeout(
    settings: Settings, ticker: str, a: str, b: str, skip_calls: bool, timeout_s: int = COMPANY_TIMEOUT_S
) -> dict[str, Any]:
    """run_brief in a child process, stopped after `timeout_s`."""
    p, out = start_brief(settings, ticker, a, b, skip_calls)
    p.join(timeout_s)
    if p.is_alive():
        stop(p)
        return {"ok": False, "error": f"timed out after {timeout_s // 60} min", "timeout": True}
    return result_of(p, out)


def parked(db: Db, today: date) -> dict[str, str]:
    """{cik: parked-until date} for companies that timed out recently."""
    rows = db.select("app_settings", {"key": f"eq.{PARK_KEY}", "select": "value"})
    val = (rows[0]["value"] if rows else None) or {}
    return {k: v for k, v in val.items() if v > today.isoformat()}


def park(db: Db, today: date, cik: int, days: int = PARK_DAYS) -> None:
    cur = parked(db, today)
    cur[str(cik)] = (today + timedelta(days=days)).isoformat()
    db.upsert("app_settings", [{"key": PARK_KEY, "value": cur}], on_conflict="key")


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


def close_stuck_jobs(db: Db, ticker: str, error: str) -> None:
    """A stopped child leaves its job row "running"; close it so the company page shows no stuck progress bar."""
    for j in db.select("jobs", {"ticker": f"eq.{ticker}", "status": "eq.running", "select": "id"}):
        db.update(
            "jobs",
            {"id": j["id"]},
            {"status": "failed", "message": error, "finished_at": datetime.now(UTC).isoformat()},
        )


def run(
    settings: Settings,
    max_companies: int = 15,
    ai_stop_usd: float = 7.0,
    av_reserve: int = 6,
    batch: bool = True,
    workers: int = WORKERS,
    poll_s: float = 2.0,
    launch_until_s: float = LAUNCH_UNTIL_S,
) -> dict[str, Any]:
    workers = workers if batch else 1
    saved = {k: os.environ.get(k) for k in (BATCH_ENV, BATCH_WAIT_ENV, RATE_SHARE_ENV)}
    os.environ[BATCH_ENV] = "1" if batch else "0"
    os.environ.setdefault(BATCH_WAIT_ENV, str(BATCH_WAIT_S))
    os.environ[RATE_SHARE_ENV] = str(workers)
    try:
        return _run(settings, max_companies, ai_stop_usd, av_reserve, batch, workers, poll_s, launch_until_s)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _run(
    settings: Settings,
    max_companies: int,
    ai_stop_usd: float,
    av_reserve: int,
    batch: bool,
    workers: int,
    poll_s: float,
    launch_until_s: float,
) -> dict[str, Any]:
    t0 = time.monotonic()
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    today = _today_et()
    hold = parked(db, today)
    todo = [c for c in queue(db, today) if str(c["cik"]) not in hold]
    timeout_s = BATCH_COMPANY_TIMEOUT_S if batch else COMPANY_TIMEOUT_S
    park_days = BATCH_PARK_DAYS if batch else PARK_DAYS
    done: list[str] = []
    skipped: list[str] = []
    stop_reason = None
    running: list[Running] = []
    pending = list(todo)

    def finish(r: Running, res: dict[str, Any]) -> None:
        t = r.company["ticker"]
        if res.get("timeout"):
            log.warning("%s timed out; parked for %d days", t, park_days)
            park(db, today, r.company["cik"], park_days)
            close_stuck_jobs(db, t, res["error"])
        (done if res.get("ok") else skipped).append(t if res.get("ok") else f"{t} ({str(res.get('error'))[:80]})")

    while pending or running:
        # Start companies while there is a free slot and nothing says stop.
        while pending and len(running) < workers and stop_reason is None:
            if time.monotonic() - t0 >= launch_until_s:
                stop_reason = f"no new companies after {launch_until_s // 60:.0f} min; the rest follow tomorrow"
                break
            if len(done) + len(running) >= max_companies:
                stop_reason = f"daily limit of {max_companies} companies"
                break
            if float(budget_state(db).spent_usd) >= ai_stop_usd:
                stop_reason = f"AI spend reached ${ai_stop_usd:.2f} this month; continues next month"
                break
            c = pending.pop(0)
            # Fetch the two call transcripts only if the free daily allowance can spare them (counting
            # those reserved by companies still running); otherwise write the brief from filings and
            # numbers now, and the call comparison follows on a later day.
            need = calls_needed(db, c["cik"], c["a"], c["b"])
            reserved = sum(r.calls for r in running)
            skip_calls = bool(need) and av_used(db) + reserved + need > AV_LIMIT - av_reserve
            p, out = start_brief(settings, c["ticker"], c["a"], c["b"], skip_calls)
            running.append(Running(c, p, out, time.monotonic(), 0 if skip_calls else need))
        if stop_reason is not None:
            pending = []
        if not running:
            break
        time.sleep(poll_s)
        for r in list(running):
            if not r.proc.is_alive():
                running.remove(r)
                finish(r, result_of(r.proc, r.out))
            elif time.monotonic() - r.started > timeout_s:
                stop(r.proc)
                running.remove(r)
                finish(r, {"ok": False, "error": f"timed out after {timeout_s // 60} min", "timeout": True})
    calls = catch_up_calls(db, settings, today, av_reserve)
    return {
        "queue": len(todo),
        "parked": sorted(hold),
        "written": done,
        "skipped": skipped,
        "stopped": stop_reason,
        "calls": calls,
        "batch": batch,
        "workers": workers,
    }


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
