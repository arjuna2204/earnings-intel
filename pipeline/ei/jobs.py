"""Pipeline jobs: refresh the ticker list, analyze (ingest) a company, daily refresh."""

from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ei.config import HISTORY_YEARS, Settings
from ei.db import Db
from ei.predecessors import KNOWN as KNOWN_PREDECESSORS
from ei.predecessors import merge_companyfacts
from ei.prices import PriceProvider, TiingoProvider
from ei.sec import SecClient, filer_type, recent_filings
from ei.sectors import classify
from ei.xbrl.derive import derive_all, valuation_snapshot
from ei.xbrl.normalize import NormalizedCompany, normalize, real_splits

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


def _prev_business_day() -> date:
    d = _today_et() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def load_prices(db: Db, provider: PriceProvider, ticker: str) -> tuple[int, str]:
    """Fetch only the days we don't already have. Returns (rows written, note)."""
    if _price_quota_left(db, provider) <= 0:
        return 0, f"{provider.name} daily limit reached; queued for tomorrow"
    last = db.select("prices", {"ticker": f"eq.{ticker}", "select": "date", "order": "date.desc", "limit": "1"})
    if last and last[0]["date"] >= _prev_business_day().isoformat():
        return 0, "up to date"  # already have the most recent weekday's close
    if last and ticker != "SPY":
        # already have the market's latest close (SPY is refreshed first each day): no request needed
        spy = db.select("prices", {"ticker": "eq.SPY", "select": "date", "order": "date.desc", "limit": "1"})
        if spy and last[0]["date"] >= spy[0]["date"]:
            return 0, "up to date"
    start = (
        date.fromisoformat(last[0]["date"]) + timedelta(days=1)
        if last
        else date(_today_et().year - HISTORY_YEARS - 1, 1, 1)
    )
    if start > _today_et():
        return 0, "up to date"
    try:
        bars = provider.daily(ticker, start)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 429:
            return 0, f"{provider.name} rate limit reached (free tier: 50/hour); queued to retry"
        raise
    db.rpc("bump_api_usage", {"p_provider": provider.name, "p_day": str(_today_et()), "p_n": 1})
    rows = [
        {
            "ticker": ticker,
            "date": str(b.day),
            "close": b.close,
            "adj_close": b.adj_close,
            "volume": b.volume,
            "split_factor": b.split_factor,
        }
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


def analyze(
    settings: Settings, ticker: str, job_id: int | None = None, primary: bool = True, fetch_street: bool | None = None
) -> dict[str, Any]:
    """`fetch_street`: call Alpha Vantage for Street data now (default: only for loads a person started;
    background loads and daily refreshes leave that to the market-cap-ordered coverage run)."""
    if fetch_street is None:
        fetch_street = primary
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

        # 3. Prices for the company (first: split history is needed for per-share data), its sector ETF and SPY
        job.step("prices", "running")
        notes = []
        for t in dict.fromkeys([ticker, sector.etf, "SPY"]):
            n, note = load_prices(db, prices, t)
            notes.append(f"{t}: {n} new" if note in ("ok", "no new prices", "up to date") else f"{t}: {note}")
        deferred = any("limit" in n for n in notes)
        job.step("prices", "deferred" if deferred else "done", "; ".join(notes))

        # 4. Financials from XBRL, split-adjusted to today's share basis
        job.step("financials", "running")
        facts = sec.companyfacts(cik)
        if pred_ciks:
            facts = merge_companyfacts(facts, [sec.companyfacts(pc) for pc in pred_ciks])
        split_rows = db.select(
            "prices", {"ticker": f"eq.{ticker}", "split_factor": "neq.1", "select": "date,split_factor"}
        )
        raw_splits = [(date.fromisoformat(r["date"]), float(r["split_factor"])) for r in split_rows]
        splits = real_splits(raw_splits)  # ignore spin-off adjustments the price feed encodes as "splits"
        nc = normalize(facts, company["fiscal_year_end"], sector.pack, min_fiscal_year=since_year, splits=splits)
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
            f"{len(nc.values)} values · {len(nc.unresolved)} not reported · {nc.currency}"
            + (f" · adjusted for {len(splits)} stock split(s)" if splits else ""),
        )

        # 5. Valuation snapshot (needs prices)
        price, price_date = latest_price(db, ticker)
        snap = valuation_snapshot(nc, sector.pack, price, price_date)
        try:
            from ei.calls.run import street_snapshot

            company_row = db.select("companies", {"cik": f"eq.{cik}", "select": "*"})[0]
            snap.update(street_snapshot(settings, db, company_row, price, fetch=fetch_street))
        except Exception as exc:  # never fail a company load over Street data
            log.warning("street data skipped: %s", exc)
        db.update(
            "companies",
            {"cik": cik},
            {
                "valuation": snap,
                "currency": nc.currency,
                "fiscal_year_end": nc.fiscal_year_end,
                "last_ingested_at": _now(),
                "history_note": (
                    "Earlier history comes from predecessor entity "
                    + ", ".join(pred_names)
                    + "; the company reorganized under a new SEC registrant."
                )
                if pred_names
                else None,
            },
        )
        try:  # 6. DCF (no AI, no extra API calls)
            from ei.dcf import run_dcf

            d = run_dcf(db, db.select("companies", {"cik": f"eq.{cik}", "select": "*"})[0])
            if d.get("per_share"):
                job.step("dcf", "done", f"DCF value ${d['per_share']:.2f} per share")
        except Exception as exc:
            log.warning("dcf skipped: %s", exc)
        try:  # 7. Insider trades from Form 4s (SEC, free)
            from ei.insiders import run_company as run_insiders

            ins = run_insiders(db, sec, {"cik": cik})
            job.step("insiders", "done", f"{ins['filings']} insider filings (Form 4) in the last 2 years")
        except Exception as exc:
            log.warning("insiders skipped: %s", exc)
        job.finish(
            "deferred" if deferred else "done",
            "Price download paused by the free-tier limit; retries automatically within 6 hours" if deferred else None,
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


# Funds people can add to any price chart (kept current on trading days; one price request each).
COMPARE_ETFS = [
    "SPY", "QQQ", "DIA", "IWM", "VTI", "SMH", "GLD", "TLT",
    "XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC",
]  # fmt: skip

# Filings that change the financial statements; anything else needs no re-read of the financials.
FINANCIAL_FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K"}


def catch_up_prices(db: Db, tiingo: PriceProvider, tickers: list[str]) -> tuple[list[str], list[str]]:
    """Bring each ticker up to the market's latest close. Stops at the first free-tier limit (the
    rest are picked up by the next retry run). Returns (updated, still behind)."""
    updated: list[str] = []
    for i, t in enumerate(tickers):
        n, note = load_prices(db, tiingo, t)
        if "limit" in note:
            return updated, tickers[i:]
        if n:
            updated.append(t)
    return updated, []


def reprice_companies(db: Db, companies: list[dict[str, Any]]) -> int:
    """Move valuation multiples to each company's latest close (no filings re-read)."""
    from ei.xbrl.derive import reprice

    n = 0
    for c in companies:
        if not c.get("valuation"):
            continue
        price, price_date = latest_price(db, c["ticker"])
        if price and price_date and price_date != c["valuation"].get("price_date"):
            db.update("companies", {"cik": c["cik"]}, {"valuation": reprice(c["valuation"], price, price_date)})
            n += 1
    return n


def refresh_all(settings: Settings) -> dict[str, Any]:
    """Daily refresh, doing only what changed:
    - prices: one request per ticker, and only when the market had a new trading day (checked with SPY);
      valuation multiples are then moved to the new price in code (no filings re-read);
    - filings: one quick EDGAR check per company; a full re-read of the financials only for companies
      that filed a new 10-K / 10-Q (or foreign equivalent); new Form 4s go straight to insider trades.
    """
    from ei.insiders import run_company as run_insiders

    db, sec = Db(settings.supabase_url, settings.supabase_secret_key), SecClient(settings.sec_user_agent)
    tiingo = TiingoProvider(settings.tiingo_api_key)
    since_year = _today_et().year - HISTORY_YEARS
    recent_cut = (_today_et() - timedelta(days=45)).isoformat()
    out: dict[str, Any] = {
        "new_trading_day": False,
        "reingest": [],
        "new_filings": 0,
        "insider_filings": 0,
        "price_notes": [],
    }
    try:
        companies = db.select("companies", {"select": "cik,ticker,sector_etf,valuation", "order": "ticker"})
        etfs = {c["sector_etf"] for c in companies if c.get("sector_etf")} | set(COMPARE_ETFS)
        # 1. Prices, only if there was a trading day since the last run
        n_spy, _ = load_prices(db, tiingo, "SPY")
        out["new_trading_day"] = n_spy > 0
        if n_spy > 0:
            _, behind = catch_up_prices(
                db, tiingo, sorted(etfs - {"SPY"}) + [c["ticker"] for c in companies if c["ticker"] not in etfs]
            )
            if behind:
                out["price_notes"].append(
                    f"{len(behind)} tickers wait for the hourly price limit; the retry run catches them up"
                )
        # 2. What did each company file?
        for c in companies:
            if c["ticker"] in etfs:
                continue
            cik = int(c["cik"])
            try:
                subs = sec.submissions(cik)
                recent = [r for r in recent_filings(cik, subs, since_year) if r["filed_date"] >= recent_cut]
                known: set[str] = set()
                if recent:
                    accs = ",".join(f'"{r["accession"]}"' for r in recent)
                    known = {
                        r["accession"]
                        for r in db.select("filings", {"accession": f"in.({accs})", "select": "accession"})
                    }
                new = [r for r in recent if r["accession"] not in known]
                if new:
                    db.upsert("filings", new, on_conflict="accession")
                    out["new_filings"] += len(new)
                if any(r["form"] in FINANCIAL_FORMS for r in new):
                    out["reingest"].append(c["ticker"])  # full re-read below
                    continue
                ins = run_insiders(db, sec, c, subs=subs)  # no request unless there are new Form 4s
                out["insider_filings"] += ins.get("new", 0)
                if out["new_trading_day"]:
                    reprice_companies(db, [c])
            except Exception:
                log.exception("refresh check failed for %s", c["ticker"])
    finally:
        sec.close()
        tiingo.close()
        db.close()
    # 3. Full re-read only where a new 10-K / 10-Q arrived
    for t in out["reingest"]:
        try:
            analyze(settings, t, primary=False)
        except Exception:
            log.exception("refresh failed for %s", t)
    return out


__all__ = ["analyze", "asdict", "mark_daily", "refresh_all", "refresh_tickers"]


def mark_daily(settings: Settings, status: str, job_id: int | None) -> dict[str, Any]:
    """Record the daily run in `jobs` (the website's backup trigger skips a day that already has one)."""
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    vals: dict[str, Any] = {"status": status}
    vals["started_at" if status == "running" else "finished_at"] = _now()
    if job_id is None:
        today = db.select(
            "jobs",
            {
                "kind": "eq.daily",
                "created_at": f"gte.{_today_et().isoformat()}",
                "select": "id",
                "order": "created_at.desc",
                "limit": "1",
            },
        )
        if today:
            job_id = int(today[0]["id"])
        else:
            row = db.insert("jobs", {"kind": "daily", **vals})
            return {"job": row["id"] if row else None}
    db.update("jobs", {"id": job_id}, vals)
    return {"job": job_id}


def retry_deferred(settings: Settings) -> list[str]:
    """Every few hours: re-run loads paused by a free-tier limit, then bring any stock or comparison
    fund that fell behind on prices up to the latest close."""
    out = _retry_jobs(settings)
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    tiingo = TiingoProvider(settings.tiingo_api_key)
    try:
        companies = db.select("companies", {"select": "cik,ticker,sector_etf,valuation", "order": "ticker"})
        etfs = {c["sector_etf"] for c in companies if c.get("sector_etf")} | set(COMPARE_ETFS)
        updated, behind = catch_up_prices(
            db, tiingo, sorted(etfs) + [c["ticker"] for c in companies if c["ticker"] not in etfs]
        )
        reprice_companies(db, [c for c in companies if c["ticker"] in updated])
        out.append(f"prices: {len(updated)} caught up" + (f", {len(behind)} still waiting" if behind else ""))
    finally:
        tiingo.close()
        db.close()
    return out


def _retry_jobs(settings: Settings) -> list[str]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    try:
        recent = db.select(
            "jobs",
            {"kind": "eq.analyze", "select": "ticker,status,id", "order": "id.desc", "limit": "200"},
        )
        calls = db.select(
            "jobs",
            {
                "kind": "eq.calls",
                "status": "eq.deferred",
                "select": "id,ticker,params",
                "order": "id.desc",
                "limit": "20",
            },
        )
    finally:
        db.close()
    latest: dict[str, str] = {}
    for row in recent:
        if row["ticker"]:
            latest.setdefault(row["ticker"], row["status"])
    tickers = [t for t, status in latest.items() if status == "deferred"]
    done = []
    for t in tickers:
        try:
            result = analyze(settings, t, primary=False)
            done.append(t if result.get("ok") else f"{t} (failed)")
        except Exception:
            log.exception("retry failed for %s", t)
    # Call comparisons paused by the transcript provider's daily quota: resume them (same job row).
    from ei.calls.run import compare_calls

    for j in calls:
        p = j.get("params") or {}
        if p.get("period_a") and p.get("period_b"):
            try:
                compare_calls(settings, j["ticker"], p["period_a"], p["period_b"], job_id=int(j["id"]))
                done.append(f"{j['ticker']} calls {p['period_a']}→{p['period_b']}")
            except Exception:
                log.exception("calls retry failed for %s", j["ticker"])
    return done
