"""Job: compare two earnings calls for a company (process-once, cache-aware, budget-aware)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import asdict
from datetime import date
from typing import Any

from ei.ai import AiClient
from ei.budget import BudgetExceeded, PricingUnverified
from ei.calls.compare import compare_guidance, compare_tone, compare_topics, price_reaction
from ei.calls.extract import ANALYSIS_VERSION, extract_call
from ei.calls.parse import parse_call
from ei.calls.tone import score_call
from ei.config import Settings
from ei.db import Db
from ei.embed import default_embedder
from ei.jobs import Job, _today_et, analyze
from ei.transcripts import AlphaVantageProvider, QuotaReached, Turn
from ei.xbrl.normalize import FiscalCalendar

log = logging.getLogger("ei.calls")


def parse_period(p: str) -> tuple[int, int]:
    m = re.fullmatch(r"FY(\d{4})Q([1-4])", p.strip().upper())
    if not m:
        raise ValueError(f"Bad period {p!r}; expected like FY2026Q1")
    return int(m.group(1)), int(m.group(2))


def label(fy: int, fq: int) -> str:
    return f"FY{fy}Q{fq}"


class AvQuota:
    """Counts Alpha Vantage requests per US-Eastern day in api_usage; raises when 25 are used."""

    def __init__(self, db: Db, limit: int) -> None:
        self.db, self.limit = db, limit

    def __call__(self) -> None:
        rows = self.db.select(
            "api_usage", {"provider": "eq.alpha_vantage", "day": f"eq.{_today_et()}", "select": "requests"}
        )
        used = int(rows[0]["requests"]) if rows else 0
        if used >= self.limit:
            raise QuotaReached(f"Alpha Vantage free tier: {self.limit} requests/day used; resumes tomorrow")
        self.db.rpc("bump_api_usage", {"p_provider": "alpha_vantage", "p_day": str(_today_et()), "p_n": 1})


def ensure_events(db: Db, av: AlphaVantageProvider, company: dict[str, Any]) -> list[dict[str, Any]]:
    """Report dates, refreshed at most once a week (1 request) unless a newer quarter is needed."""
    cik = company["cik"]
    rows = db.select("earnings_events", {"cik": f"eq.{cik}", "select": "*", "order": "report_date.desc"})
    fresh = rows and (_today_et() - date.fromisoformat(rows[0]["report_date"])).days < 80
    if fresh:
        return rows
    cal = FiscalCalendar.from_mmdd(company["fiscal_year_end"] or "1231")
    events = av.earnings_events(company["ticker"])
    out = {}
    for e in events:
        fy, fq = cal.label(e.period_end)
        out[(fy, fq)] = {
            "cik": cik,
            "fiscal_year": fy,
            "fiscal_quarter": fq,
            "period_end": str(e.period_end),
            "report_date": str(e.report_date),
            "report_time": e.report_time,
            "eps_reported": e.eps_reported,
            "eps_estimated": e.eps_estimated,
        }
    if out:
        db.upsert("earnings_events", list(out.values()), on_conflict="cik,fiscal_year,fiscal_quarter")
    return db.select("earnings_events", {"cik": f"eq.{cik}", "select": "*", "order": "report_date.desc"})


def get_transcript(db: Db, av: AlphaVantageProvider, company: dict[str, Any], fy: int, fq: int) -> list[Turn] | None:
    cik = company["cik"]
    rows = db.select(
        "transcripts", {"cik": f"eq.{cik}", "fiscal_year": f"eq.{fy}", "fiscal_quarter": f"eq.{fq}", "select": "turns"}
    )
    if rows:
        return [Turn(**t) for t in rows[0]["turns"]]
    turns = av.transcript(company["ticker"], fy, fq)
    if not turns:
        return None
    payload = [asdict(t) for t in turns]
    db.upsert(
        "transcripts",
        [
            {
                "cik": cik,
                "fiscal_year": fy,
                "fiscal_quarter": fq,
                "provider": av.name,
                "turns": payload,
                "sha256": hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
            }
        ],
        on_conflict="cik,fiscal_year,fiscal_quarter",
    )
    return turns


def _series(db: Db, ticker: str) -> list[tuple[date, float]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        part = db.select(
            "prices",
            {
                "ticker": f"eq.{ticker}",
                "select": "date,adj_close",
                "order": "date.asc",
                "offset": str(start),
                "limit": "1000",
            },
        )
        rows += part
        if len(part) < 1000:
            break
        start += 1000
    return [(date.fromisoformat(r["date"]), float(r["adj_close"])) for r in rows]


def analyze_call(
    db: Db,
    av: AlphaVantageProvider,
    ai: AiClient | None,
    company: dict[str, Any],
    fy: int,
    fq: int,
    event: dict[str, Any] | None,
) -> dict[str, Any]:
    """Cached per (company, quarter, analysis version). Re-runs only missing AI parts."""
    cik = company["cik"]
    key = {
        "cik": f"eq.{cik}",
        "fiscal_year": f"eq.{fy}",
        "fiscal_quarter": f"eq.{fq}",
        "analysis_version": f"eq.{ANALYSIS_VERSION}",
    }
    cached = db.select("call_analysis", {**key, "select": "*"})
    if cached and cached[0]["status"] == "done":
        return cached[0]

    turns = get_transcript(db, av, company, fy, fq)
    if not turns:
        raise LookupError(f"No transcript available for {company['ticker']} {label(fy, fq)}")
    parsed = parse_call(turns)
    row: dict[str, Any] = {
        "cik": cik,
        "fiscal_year": fy,
        "fiscal_quarter": fq,
        "analysis_version": ANALYSIS_VERSION,
        "parsed": parsed.to_json(),
        "tone": score_call(turns, parsed),
        "status": "done",
        "note": None,
        "cost_usd": 0,
    }
    if event:
        row["price_reaction"] = price_reaction(
            date.fromisoformat(event["report_date"]),
            event.get("report_time"),
            _series(db, company["ticker"]),
            _series(db, company["sector_etf"] or "SPY"),
        )
    if ai is None:
        row.update(status="partial", note="AI analysis not run (no API key)")
    else:
        try:
            kept, evas, dropped, cost = extract_call(ai, company["name"], label(fy, fq), turns, parsed, cik)
            row.update(extraction=kept, evasiveness=evas, dropped_claims=dropped, cost_usd=cost)
        except (BudgetExceeded, PricingUnverified) as exc:
            row.update(status="partial", note=str(exc))
    db.upsert("call_analysis", [row], on_conflict="cik,fiscal_year,fiscal_quarter,analysis_version")
    return row


def compare_calls(
    settings: Settings, ticker: str, period_a: str, period_b: str, job_id: int | None = None
) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    job = Job(db, "calls", ticker.upper(), job_id)
    av = AlphaVantageProvider(settings.alpha_vantage_api_key, quota_check=AvQuota(db, AlphaVantageProvider.daily_limit))
    ai = AiClient(settings.anthropic_api_key, db) if settings.anthropic_api_key else None
    (fa, qa), (fb, qb) = sorted([parse_period(period_a), parse_period(period_b)])
    try:
        comp = db.select("companies", {"ticker": f"eq.{ticker.upper()}", "select": "*"})
        if not comp:
            job.step("company", "running", "Loading company data first")
            analyze(settings, ticker, primary=True)
            comp = db.select("companies", {"ticker": f"eq.{ticker.upper()}", "select": "*"})
        company = comp[0]
        cik = company["cik"]

        job.step("dates", "running")
        events = {(e["fiscal_year"], e["fiscal_quarter"]): e for e in ensure_events(db, av, company)}
        job.step("dates", "done", f"{len(events)} report dates")

        results = {}
        for fy, fq in ((fa, qa), (fb, qb)):
            step = label(fy, fq)
            job.step(step, "running", "transcript → structure → tone → AI extraction")
            r = analyze_call(db, av, ai, company, fy, fq, events.get((fy, fq)))
            results[step] = r
            job.step(
                step,
                "done" if r["status"] == "done" else "partial",
                f"{len(r['parsed']['turns'])} turns · {len(r['parsed']['exchanges'])} Q&A exchanges · ${float(r['cost_usd']):.4f}"
                + (f" · {r['note']}" if r.get("note") else ""),
            )

        a, b = results[label(fa, qa)], results[label(fb, qb)]
        job.step("compare", "running")
        emb = default_embedder()
        ea, eb = a.get("extraction") or {}, b.get("extraction") or {}
        words_a = [t["words"] for t in a["parsed"]["turns"]]
        words_b = [t["words"] for t in b["parsed"]["turns"]]
        result = {
            "period_a": label(fa, qa),
            "period_b": label(fb, qb),
            "embedder": emb.name,
            "guidance": compare_guidance(ea.get("guidance", []), eb.get("guidance", []), emb),
            "topics": compare_topics(ea.get("topics", []), eb.get("topics", []), words_a, words_b, emb),
            "tone": compare_tone(a["tone"], b["tone"]),
            "price_reaction": {label(fa, qa): a.get("price_reaction"), label(fb, qb): b.get("price_reaction")},
            "partial": a["status"] != "done" or b["status"] != "done",
        }
        db.upsert(
            "call_comparisons",
            [
                {
                    "cik": cik,
                    "period_a": label(fa, qa),
                    "period_b": label(fb, qb),
                    "analysis_version": ANALYSIS_VERSION,
                    "result": result,
                }
            ],
            on_conflict="cik,period_a,period_b,analysis_version",
        )
        job.step("compare", "done", f"{len(result['guidance'])} guidance items · {len(result['topics'])} topics")
        job.finish("done", None, cik)
        return {"ok": True, "cik": cik}
    except QuotaReached as exc:
        job.finish("deferred", str(exc))
        return {"ok": False, "deferred": True}
    except LookupError as exc:
        job.finish("failed", str(exc))
        return {"ok": False}
    except Exception as exc:
        log.exception("compare failed")
        job.finish("failed", f"{type(exc).__name__}: {str(exc)[:400]}")
        raise
    finally:
        av.close()
        db.close()
