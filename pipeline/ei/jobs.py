"""Pipeline jobs: refresh the ticker list, analyze (ingest) a company, daily refresh."""

from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from ei.config import HISTORY_YEARS, Settings
from ei.db import Db
from ei.predecessors import KNOWN as KNOWN_PREDECESSORS
from ei.predecessors import merge_companyfacts
from ei.prices import PriceProvider, TiingoProvider
from ei.sec import SecClient, filer_type, recent_filings
from ei.sectors import classify
from ei.xbrl.derive import derive_all, valuation_snapshot
from ei.xbrl.normalize import NormalizedCompany, normalize

log = logging.getLogger("ei.jobs")
ET = ZoneInfo("America/New_York")


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _today_et() -> date:
    return datetime.now(ET).date()


class Job:
    """Tracks one job row so the status page can show progress step by step."""

    def __init__(self, db: Db, kind: str, ticker: str | None = None, job_id: int | None = None) -> None:
        self.db = db
        self.steps: dict[str, Any] = {}
        if job_id is None:
            row = db.insert("jobs", {"kind": kind, "ticker": ticker, "status": "running", "started_at": _now()})
            assert row is not None
            job_id = int(row["id"])
        else:
            db.update("jobs", {"id": job_id}, {"status": "running", "started_at": _now()})
        self.id = job_id

    def step(self, name: str, status: str, detail: str | None = None) -> None:
        self.steps[name] = {"status": status, "detail": detail, "at": _now()}
        self.db.update("jobs", {"id": self.id}, {"steps": self.steps})

    def finish(self, status: str, message: str | None = None, cik: int | None = None) -> None:
        vals: dict[str, Any] = {"status": status, "message": message, "finished_at": _now()}
        if cik is not None:
            vals["cik"] = cik
        self.db.update("jobs", {"id": self.id}, vals)


# ---------------------------------------------------------------- tickers


def refresh_tickers(settings: Settings) -> int:
    db, sec = Db(settings.supabase_url, settings.supabase_secret_key), SecClient(settings.sec_user_agent)
    job = Job(db, "tickers")
    try:
        rows = sec.tickers()
        # A ticker can appear twice (e.g. two share classes listed under one CIK keep distinct tickers).
        unique = {r["ticker"]: {**r, "updated_at": _now()} for r in rows}
        n = db.upsert("tickers", list(unique.values()), on_conflict="ticker")
        job.finish("done", f"{n} US-listed tickers loaded")
        return n
    except Exception as exc:
        job.finish("failed", str(exc)[:500])
        raise
    finally:
        sec.close()
        db.close()


# ---------------------------------------------------------------- prices


def _price_quota_left(db: Db, provider: PriceProvider) -> int:
    rows = db.select("api_usage", {"provider": f"eq.{provider.name}", "day": f"eq.{_today_et()}", "select": "requests"})
    used = int(rows[0]["requests"]) if rows else 0
    return provider.daily_limit - used


def load_prices(db: Db, provider: PriceProvider, ticker: str) -> tuple[int, str]:
    """Fetch only the days we don't already have. Returns (rows written, note)."""
    if _price_quota_left(db, provider) <= 0:
        return 0, f"{provider.name} daily limit reached; queued for tomorrow"
    last = db.select("prices", {"ticker": f"eq.{ticker}", "select": "date", "order": "date.desc", "limit": "1"})
    start = (
        date.fromisoformat(last[0]["date"]) + timedelta(days=1)
        if last
        else date(_today_et().year - HISTORY_YEARS - 1, 1, 1)
    )
    if start > _today_et():
        return 0, "up to date"
    bars = provider.daily(ticker, start)
    db.rpc("bump_api_usage", {"p_provider": provider.name, "p_day": str(_today_et()), "p_n": 1})
    rows = [
        {"ticker": ticker, "date": str(b.day), "close": b.close, "adj_close": b.adj_close, "volume": b.volume}
        for b in bars
    ]
    if rows:
        db.upsert("prices", rows, on_conflict="ticker,date")
    return len(rows), "ok" if rows else "no new prices"


def latest_price(db: Db, ticker: str) -> tuple[float | None, str | None]:
    rows = db.select("prices", {"ticker": f"eq.{ticker}", "select": "date,close", "order": "date.desc", "limit": "1"})
    return (float(rows[0]["close"]), rows[0]["date"]) if rows else (None, None)


# ---------------------------------------------------------------- analyze


def _metric_rows(cik: int, nc: NormalizedCompany) -> list[dict[str, Any]]:
    rows = []
    for pv in nc.values.values():
        rows.append(
            {
                "cik": cik,
                "metric": pv.metric,
                "fiscal_year": pv.fiscal_year,
                "fiscal_period": pv.fiscal_period,
                "period_start": str(pv.period_start) if pv.period_start else None,
                "period_end": str(pv.period_end),
                "value": pv.value,
                "unit": pv.unit,
                "source": pv.source,
                "xbrl_tag": pv.xbrl_tag,
                "derivation": pv.derivation,
                "accession": pv.accession,
                "filed_date": str(pv.filed) if pv.filed and pv.filed != date.min else None,
            }
        )
    return rows


def analyze(settings: Settings, ticker: str, job_id: int | None = None, primary: bool = True) -> dict[str, Any]:
    ticker = ticker.strip().upper()
    db, sec = Db(settings.supabase_url, settings.supabase_secret_key), SecClient(settings.sec_user_agent)
    prices = TiingoProvider(settings.tiingo_api_key)
    job = Job(db, "analyze", ticker, job_id)
    since_year = _today_et().year - HISTORY_YEARS
    try:
        # 1. Resolve ticker -> CIK, name, SIC, fiscal calendar, filer type, sector ETF
        job.step("resolve", "running")
        hit = db.select("tickers", {"ticker": f"eq.{ticker}", "select": "cik,name,exchange"})
        if not hit:
            job.finish("failed", f"Ticker {ticker} is not in the US-listed company list")
            return {"ok": False}
        cik = int(hit[0]["cik"])
        subs = sec.submissions(cik)
        sector = classify(subs.get("sic"))
        company = {
            "cik": cik,
            "ticker": ticker,
            "name": subs.get("name") or hit[0]["name"],
            "exchange": hit[0].get("exchange"),
            "sic": subs.get("sic") or None,
            "sic_description": subs.get("sicDescription") or None,
            "sector_pack": sector.pack,
            "sector_etf": sector.etf,
            "sector_note": sector.ambiguous_reason,
            "filer_type": filer_type(subs),
            "fiscal_year_end": subs.get("fiscalYearEnd") or None,
            "state_of_inc": subs.get("stateOfIncorporation") or None,
        }
        existing = db.select("companies", {"cik": f"eq.{cik}", "select": "is_primary,predecessor_ciks"})
        company["is_primary"] = primary or bool(existing and existing[0]["is_primary"])
        pred_ciks = sorted(
            set(KNOWN_PREDECESSORS.get(cik, [])) | set((existing[0]["predecessor_ciks"] or []) if existing else [])
        )
        company["predecessor_ciks"] = pred_ciks
        db.upsert("companies", [company], on_conflict="cik")
        job.step("resolve", "done", f"{company['name']} · CIK {cik} · {sector.pack} pack · benchmark {sector.etf}")

        # 2. Filing list (15 years)
        job.step("filings", "running")
        rows = recent_filings(cik, subs, since_year)
        for page in sec.older_submission_pages(subs, since_year):
            rows += recent_filings(cik, page, since_year)
        pred_names = []
        for pc in pred_ciks:
            psubs = sec.submissions(pc)
            pred_names.append(f"{psubs.get('name', 'predecessor')} (CIK {pc})")
            prow = recent_filings(pc, psubs, since_year)
            for page in sec.older_submission_pages(psubs, since_year):
                prow += recent_filings(pc, page, since_year)
            rows += [{**r, "cik": cik} for r in prow]  # listed under the current company
        db.upsert("filings", list({r["accession"]: r for r in rows}.values()), on_conflict="accession")
        job.step("filings", "done", f"{len(rows)} filings since {since_year}")

        # 3. Financials from XBRL
        job.step("financials", "running")
        facts = sec.companyfacts(cik)
        if pred_ciks:
            facts = merge_companyfacts(facts, [sec.companyfacts(pc) for pc in pred_ciks])
        nc = normalize(facts, company["fiscal_year_end"], sector.pack, min_fiscal_year=since_year)
        nc = derive_all(nc, sector.pack)
        db.replace_rows(
            "metric_values",
            {"cik": cik},
            _metric_rows(cik, nc),
            on_conflict="cik,metric,fiscal_year,fiscal_period",
        )
        db.replace_rows(
            "unresolved_metrics",
            {"cik": cik},
            [{"cik": cik, "metric": m, "reason": r} for m, r in nc.unresolved.items()],
            on_conflict="cik,metric",
        )
        job.step(
            "financials",
            "done",
            f"{len(nc.values)} values · {len(nc.unresolved)} not reported · {nc.currency}",
        )

        # 4. Prices for the company, its sector ETF and SPY
        job.step("prices", "running")
        notes = []
        for t in dict.fromkeys([ticker, sector.etf, "SPY"]):
            n, note = load_prices(db, prices, t)
            notes.append(f"{t}: {n} new" if note in ("ok", "no new prices", "up to date") else f"{t}: {note}")
        deferred = any("limit" in n for n in notes)
        job.step("prices", "deferred" if deferred else "done", "; ".join(notes))

        # 5. Valuation snapshot (needs prices)
        price, price_date = latest_price(db, ticker)
        snap = valuation_snapshot(nc, sector.pack, price, price_date)
        db.update(
            "companies",
            {"cik": cik},
            {
                "valuation": snap,
                "currency": nc.currency,
                "fiscal_year_end": nc.fiscal_year_end,
                "last_ingested_at": _now(),
            },
        )
        job.finish(
            "deferred" if deferred else "done",
            "Price download will resume tomorrow" if deferred else None,
            cik,
        )
        return {"ok": True, "cik": cik, "values": len(nc.values), "unresolved": sorted(nc.unresolved)}
    except Exception as exc:
        log.exception("analyze failed")
        job.finish("failed", f"{type(exc).__name__}: {str(exc)[:400]}")
        raise
    finally:
        sec.close()
        prices.close()
        db.close()


def refresh_all(settings: Settings) -> list[str]:
    """Daily: re-ingest every company we track (cheap: SEC + incremental prices, no AI)."""
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    try:
        tickers = [r["ticker"] for r in db.select("companies", {"select": "ticker", "order": "ticker"})]
    finally:
        db.close()
    done = []
    for t in tickers:
        try:
            analyze(settings, t, primary=False)
            done.append(t)
        except Exception:
            log.exception("refresh failed for %s", t)
    return done


__all__ = ["analyze", "asdict", "refresh_all", "refresh_tickers"]
