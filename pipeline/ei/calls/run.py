"""Job: compare two earnings calls for a company (process-once, cache-aware, budget-aware)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import asdict
from datetime import date, timedelta
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

    def __init__(self, db: Db, limit: int, reserve: int = 0) -> None:
        """`reserve`: requests left untouched for on-demand comparisons (used by background backfill)."""
        self.db, self.limit = db, limit - reserve

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
    free_only: bool = False,
) -> dict[str, Any]:
    """Cached per (company, quarter, analysis version). Re-runs only missing AI parts.

    free_only=True (background backfill): transcript, structure, word-list tone and price reaction
    only; AI extraction runs later if and when this quarter is compared."""
    cik = company["cik"]
    key = {
        "cik": f"eq.{cik}",
        "fiscal_year": f"eq.{fy}",
        "fiscal_quarter": f"eq.{fq}",
        "analysis_version": f"eq.{ANALYSIS_VERSION}",
    }
    cached = db.select("call_analysis", {**key, "select": "*"})
    if cached and (cached[0]["status"] == "done" or free_only):
        return cached[0]
    if free_only:
        ai = None

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
        row.update(
            status="partial",
            note="Tone only (background history); AI analysis runs when this quarter is compared"
            if free_only
            else "AI analysis not run (no API key)",
        )
    else:
        try:
            kept, evas, dropped, cost, raw = extract_call(ai, company["name"], label(fy, fq), turns, parsed, cik)
            row.update(extraction=kept, evasiveness=evas, dropped_claims=dropped, cost_usd=cost, raw_extraction=raw)
        except (BudgetExceeded, PricingUnverified) as exc:
            row.update(status="partial", note=str(exc))
    db.upsert("call_analysis", [row], on_conflict="cik,fiscal_year,fiscal_quarter,analysis_version")
    return row


def build_result(a: dict[str, Any], b: dict[str, Any], la: str, lb: str) -> dict[str, Any]:
    emb = default_embedder()
    ea, eb = a.get("extraction") or {}, b.get("extraction") or {}
    words_a = [t["words"] for t in a["parsed"]["turns"]]
    words_b = [t["words"] for t in b["parsed"]["turns"]]
    return {
        "period_a": la,
        "period_b": lb,
        "embedder": emb.name,
        "guidance": compare_guidance(ea.get("guidance", []), eb.get("guidance", []), emb),
        "topics": compare_topics(ea.get("topics", []), eb.get("topics", []), words_a, words_b, emb),
        "tone": compare_tone(a["tone"], b["tone"]),
        "price_reaction": {la: a.get("price_reaction"), lb: b.get("price_reaction")},
        "partial": a["status"] != "done" or b["status"] != "done",
    }


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
        result = build_result(a, b, label(fa, qa), label(fb, qb))
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
        job.step("history", "running", "Loading up to 8 recent quarters for tone trends (free, no AI)")
        bf = backfill_history(settings, ticker)
        job.step(
            "history",
            "done" if not bf.get("paused") else "deferred",
            f"{len(bf.get('loaded', []))} quarters ready"
            + (" · continues tomorrow (daily transcript limit)" if bf.get("paused") else ""),
        )
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


BACKFILL_QUARTERS = 8
BACKFILL_RESERVE = 5  # of the 25 daily transcript requests, keep 5 free for comparisons you start


def backfill_history(settings: Settings, ticker: str) -> dict[str, Any]:
    """Option A: after a comparison, load the last 8 reported quarters' transcripts and score their
    tone (free; no AI). Stops when today's background allowance is used and resumes on the next run."""
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    av = AlphaVantageProvider(
        settings.alpha_vantage_api_key,
        quota_check=AvQuota(db, AlphaVantageProvider.daily_limit, reserve=BACKFILL_RESERVE),
    )
    loaded, missing = [], []
    try:
        comp = db.select("companies", {"ticker": f"eq.{ticker.upper()}", "select": "*"})
        if not comp:
            return {"ok": False, "reason": "company not loaded"}
        company = comp[0]
        events = db.select(
            "earnings_events",
            {
                "cik": f"eq.{company['cik']}",
                "select": "*",
                "order": "report_date.desc",
                "limit": str(BACKFILL_QUARTERS),
            },
        )
        for e in events:
            fy, fq = int(e["fiscal_year"]), int(e["fiscal_quarter"])
            try:
                analyze_call(db, av, None, company, fy, fq, e, free_only=True)
                loaded.append(label(fy, fq))
            except LookupError:
                missing.append(label(fy, fq))  # provider has no transcript for that quarter
        return {"ok": True, "loaded": loaded, "no_transcript": missing}
    except QuotaReached:
        return {"ok": True, "loaded": loaded, "paused": "background transcript allowance used for today"}
    finally:
        av.close()
        db.close()


def backfill_all(settings: Settings) -> list[dict[str, Any]]:
    """Daily: continue history backfill for every company that has at least one analyzed call."""
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    try:
        ciks = {r["cik"] for r in db.select("call_analysis", {"select": "cik"})}
        tickers = [r["ticker"] for r in db.select("companies", {"select": "cik,ticker"}) if r["cik"] in ciks]
    finally:
        db.close()
    out = []
    for t in tickers:
        res = backfill_history(settings, t)
        out.append({"ticker": t, **res})
        if res.get("paused"):
            break
    return out


def reverify(settings: Settings, ticker: str) -> dict[str, Any]:
    """Re-run quote/number verification from stored raw model output and rebuild comparisons.
    No transcript requests and no AI calls; used after improving verification or matching rules."""
    from ei.calls.extract import Extraction, evasiveness_rows, verify_extraction

    db = Db(settings.supabase_url, settings.supabase_secret_key)
    try:
        company = db.select("companies", {"ticker": f"eq.{ticker.upper()}", "select": "*"})[0]
        cik = company["cik"]
        rows = db.select(
            "call_analysis", {"cik": f"eq.{cik}", "analysis_version": f"eq.{ANALYSIS_VERSION}", "select": "*"}
        )
        n = 0
        for r in rows:
            if not r.get("raw_extraction"):
                continue
            t = db.select(
                "transcripts",
                {
                    "cik": f"eq.{cik}",
                    "fiscal_year": f"eq.{r['fiscal_year']}",
                    "fiscal_quarter": f"eq.{r['fiscal_quarter']}",
                    "select": "turns",
                },
            )
            turns = [Turn(**x) for x in t[0]["turns"]]
            parsed = parse_call(turns)
            ex = Extraction.model_validate(r["raw_extraction"])
            kept, dropped = verify_extraction(ex, turns, parsed)
            db.update(
                "call_analysis",
                {
                    "cik": cik,
                    "fiscal_year": r["fiscal_year"],
                    "fiscal_quarter": r["fiscal_quarter"],
                    "analysis_version": ANALYSIS_VERSION,
                },
                {"extraction": kept, "evasiveness": evasiveness_rows(ex, parsed), "dropped_claims": dropped},
            )
            n += 1
        comps = db.select(
            "call_comparisons",
            {"cik": f"eq.{cik}", "analysis_version": f"eq.{ANALYSIS_VERSION}", "select": "period_a,period_b"},
        )
    finally:
        db.close()
    for c in comps:
        compare_only(settings, company, c["period_a"], c["period_b"])
    return {"ok": True, "reverified_calls": n, "comparisons": len(comps)}


def compare_only(settings: Settings, company: dict[str, Any], la: str, lb: str) -> None:
    """Rebuild one comparison from stored analyses (no external requests)."""
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    try:

        def load(lbl: str) -> dict[str, Any]:
            fy, fq = parse_period(lbl)
            return db.select(
                "call_analysis",
                {
                    "cik": f"eq.{company['cik']}",
                    "fiscal_year": f"eq.{fy}",
                    "fiscal_quarter": f"eq.{fq}",
                    "analysis_version": f"eq.{ANALYSIS_VERSION}",
                    "select": "*",
                },
            )[0]

        a, b = load(la), load(lb)
        db.upsert(
            "call_comparisons",
            [
                {
                    "cik": company["cik"],
                    "period_a": la,
                    "period_b": lb,
                    "analysis_version": ANALYSIS_VERSION,
                    "result": build_result(a, b, la, lb),
                }
            ],
            on_conflict="cik,period_a,period_b,analysis_version",
        )
    finally:
        db.close()


def estimates_stale(db: Db, company: dict[str, Any], fetched: date) -> bool:
    """Estimates move most around earnings: re-check weekly within 3 weeks of a report, else monthly.
    Keeps the free 25 requests/day stretching across hundreds of stocks."""
    age = (_today_et() - fetched).days
    if age >= 30:
        return True
    if age < 7:
        return False
    today = _today_et()
    near = [today - timedelta(days=21), today + timedelta(days=21)]
    cal = db.select("earnings_calendar", {"ticker": f"eq.{company['ticker']}", "select": "report_date"})
    ev = db.select(
        "earnings_events",
        {"cik": f"eq.{company['cik']}", "select": "report_date", "order": "report_date.desc", "limit": "1"},
    )
    dates = [date.fromisoformat(str(r["report_date"])[:10]) for r in cal + ev]
    return any(near[0] <= d <= near[1] for d in dates)


def ensure_estimates(db: Db, av: AlphaVantageProvider, company: dict[str, Any]) -> list[dict[str, Any]]:
    """Consensus EPS estimates (1 request), refreshed on the schedule in `estimates_stale`."""
    cik = company["cik"]
    rows = db.select("eps_estimates", {"cik": f"eq.{cik}", "select": "*", "order": "fetched_at.desc"})
    if rows and not estimates_stale(db, company, date.fromisoformat(str(rows[0]["fetched_at"])[:10])):
        return rows
    est = av.earnings_estimates(company["ticker"])
    if est:
        db.delete("eps_estimates", {"cik": cik})
        db.upsert("eps_estimates", [{"cik": cik, **e} for e in est], on_conflict="cik,period_end,horizon")
        # weekly snapshot of upcoming periods, for the estimate-revisions chart
        today = _today_et()
        snap = [
            {
                "cik": cik,
                "snapshot_date": today.isoformat(),
                **{
                    k: e.get(k)
                    for k in ("horizon", "period_end", "eps_avg", "eps_low", "eps_high", "revenue_avg", "analysts")
                },
            }
            for e in est
            if str(e.get("period_end", "")) >= (today - timedelta(days=30)).isoformat()
        ]
        if snap:
            db.upsert("eps_estimate_history", snap, on_conflict="cik,snapshot_date,horizon,period_end")
    return db.select("eps_estimates", {"cik": f"eq.{cik}", "select": "*"})


def street_snapshot(
    settings: Settings, db: Db, company: dict[str, Any], price: float | None, fetch: bool = True
) -> dict[str, Any]:
    """Adjusted (Street) and forward P/E inputs; quietly skipped if the free quota is used up.
    fetch=False uses only stored Street data (no Alpha Vantage requests)."""
    from ei.street import street_multiples

    if price is None:
        return {}
    if not fetch or not settings.alpha_vantage_api_key:
        events = db.select("earnings_events", {"cik": f"eq.{company['cik']}", "select": "*"})
        estimates = db.select("eps_estimates", {"cik": f"eq.{company['cik']}", "select": "*"})
        return street_multiples(price, events, estimates, _today_et()) if events or estimates else {}
    av = AlphaVantageProvider(
        settings.alpha_vantage_api_key,
        quota_check=AvQuota(db, AlphaVantageProvider.daily_limit, reserve=BACKFILL_RESERVE),
    )
    try:
        try:
            events = ensure_events(db, av, company)
        except QuotaReached:
            events = db.select("earnings_events", {"cik": f"eq.{company['cik']}", "select": "*"})
        try:
            estimates = ensure_estimates(db, av, company)
        except QuotaReached:
            estimates = db.select("eps_estimates", {"cik": f"eq.{company['cik']}", "select": "*"})
        return street_multiples(price, events, estimates, _today_et())
    finally:
        av.close()
