"""Basic fundamentals for the ~500 largest US companies, so the screener covers the market, not only
the companies researched in full. No AI and no Alpha Vantage: SEC companyfacts (free) for the numbers,
Cboe delayed quotes (free, no key) for prices.

Weekly (Sundays) every company's financials are re-read; every weekday only prices update and the
multiples are repriced in code. Companies with full research are skipped (the screener uses theirs).
Price history accumulates one close per day; Cboe's chart endpoint seeds a year of closes once.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ei.db import Db
from ei.http import RateLimiter, get_with_retries
from ei.sec import SecClient
from ei.sectors import classify
from ei.xbrl.derive import derive_all, reprice, valuation_snapshot
from ei.xbrl.normalize import normalize

log = logging.getLogger(__name__)

QUOTE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/{symbol}.json"
HIST_URL = "https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/{symbol}.json"
TOP_N = 500
KEEP_DAYS = 400

# the latest value of each, for the screener
METRICS = ("revenue_growth_yoy", "operating_margin", "roic", "net_margin", "gross_margin")


def _sym(ticker: str) -> str:
    # Cboe uses dots for share classes (BRK.B); SEC uses dashes
    return ticker.replace("-", ".").upper()


class Cboe:
    def __init__(self) -> None:
        self._client = httpx.Client(
            timeout=30, headers={"User-Agent": "Mozilla/5.0 (research tool)"}, follow_redirects=True
        )
        self._limiter = RateLimiter(rate=1.5)  # Cboe throttles bursts (429s after ~500 fast requests)

    def close(self) -> None:
        self._client.close()

    def quote(self, ticker: str) -> tuple[float, str] | None:
        """(last price, ISO date) from the delayed quote."""
        try:
            r = get_with_retries(self._client, QUOTE_URL.format(symbol=_sym(ticker)), limiter=self._limiter, attempts=4)
        except httpx.HTTPError:
            return None  # throttled or down: keep yesterday's price rather than failing the company
        if r.status_code != 200:
            return None
        d = r.json().get("data") or {}
        px = d.get("current_price") or d.get("close") or d.get("prev_day_close")
        if not px:
            return None
        return float(px), _trade_day()

    def history(self, ticker: str) -> list[tuple[str, float]]:
        try:
            r = get_with_retries(self._client, HIST_URL.format(symbol=_sym(ticker)), limiter=self._limiter, attempts=4)
        except httpx.HTTPError:
            return []
        if r.status_code != 200:
            return []
        rows = (r.json().get("data") or []) if isinstance(r.json(), dict) else []
        out = []
        for row in rows:
            try:
                out.append((str(row["date"])[:10], float(row["close"])))
            except (KeyError, TypeError, ValueError):
                continue
        return sorted(out)


def _trade_day(now: datetime | None = None) -> str:
    """The session a delayed quote belongs to: today after the 4pm ET close, else the previous weekday."""
    et = (now or datetime.now(ZoneInfo("America/New_York"))).astimezone(ZoneInfo("America/New_York"))
    d = et.date()
    if et.weekday() >= 5 or (et.hour, et.minute) < (16, 15):
        d -= timedelta(days=1)
        while d.weekday() >= 5:
            d -= timedelta(days=1)
    return d.isoformat()


def _latest(nc: Any, metric: str) -> float | None:
    rows = [pv for (m, _, _), pv in nc.values.items() if m == metric]
    return max(rows, key=lambda pv: pv.period_end).value if rows else None


def snapshot(sec: SecClient, cik: int, price: float | None, price_date: str | None) -> dict[str, Any]:
    sub = sec.submissions(cik)
    sector = classify(sub.get("sic"))
    facts = sec.companyfacts(cik)
    nc = derive_all(
        normalize(facts, sub.get("fiscalYearEnd") or "1231", sector.pack, min_fiscal_year=date.today().year - 4),
        sector.pack,
    )
    snap = valuation_snapshot(nc, sector.pack, price, price_date)
    # Per-share history isn't split-adjusted here (no price history to detect splits), so take P/E as
    # market value ÷ net income, which a split can't distort.
    ni = _latest(nc, "net_income_ttm")
    mcap = snap.get("market_cap")
    snap["pe"] = mcap / ni if isinstance(mcap, (int, float)) and ni and ni > 0 else None
    snap["net_income_ttm"] = ni
    for m in METRICS:
        snap[m] = _latest(nc, m)
    snap["sector_etf"] = sector.etf
    snap["sic_description"] = sub.get("sicDescription")
    return snap


def _ret_1y(hist: list[list[Any]]) -> float | None:
    if len(hist) < 200:
        return None
    end_d, end_px = date.fromisoformat(hist[-1][0]), hist[-1][1]
    target = (end_d - timedelta(days=365)).isoformat()
    start = next((h for h in hist if h[0] >= target), None)
    return end_px / start[1] - 1 if start and start[1] else None


def run(
    settings: Any, full: bool | None = None, tickers: list[str] | None = None, limit: int = TOP_N
) -> dict[str, Any]:
    """`full`: re-read financials (default: on Sundays, or for companies not read yet)."""
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    sec = SecClient(settings.sec_user_agent)
    cboe = Cboe()
    full = full if full is not None else datetime.now().weekday() == 6
    researched = {r["cik"] for r in db.select("companies", {"select": "cik"})}
    uni = db.select("universe", {"select": "cik,ticker,name,rank", "rank": f"lte.{limit}", "order": "rank.asc"})
    have = {r["cik"]: r for r in db.select_all("lite_companies", {"select": "cik,snapshot,history,fundamentals_at"})}
    stats = {"repriced": 0, "read": 0, "skipped_researched": 0, "no_price": 0, "errors": 0}
    errors: dict[str, str] = {}
    rows: list[dict[str, Any]] = []
    try:
        for u in uni:
            if tickers and u["ticker"] not in tickers:
                continue
            if u["cik"] in researched:
                stats["skipped_researched"] += 1
                continue
            try:
                q = cboe.quote(u["ticker"])
                prev = have.get(u["cik"])
                hist: list[list[Any]] = list(prev.get("history") or []) if prev else []
                today_session = _trade_day()
                hist = [h for h in hist if str(h[0]) <= today_session]  # no entries dated in the future
                if not hist:  # seed a year of closes once
                    hist = [[d, c] for d, c in cboe.history(u["ticker"])][-KEEP_DAYS:]
                if q:
                    px, day = q
                    if hist and hist[-1][0] == day:
                        hist[-1] = [day, px]
                    elif not hist or str(hist[-1][0]) < day:
                        hist.append([day, px])
                else:
                    stats["no_price"] += 1
                hist = hist[-KEEP_DAYS:]
                price: float | None = None
                pdate: str | None = None
                if q:
                    price, pdate = q
                elif hist:
                    price, pdate = float(hist[-1][1]), str(hist[-1][0])  # type: ignore[arg-type]
                if full or not prev or not prev.get("snapshot"):
                    snap = snapshot(sec, u["cik"], price, pdate)
                    stats["read"] += 1
                    fund_at: str | None = datetime.now().isoformat()
                else:
                    snap = dict(prev["snapshot"])
                    fund_at = prev.get("fundamentals_at")
                    if price and isinstance(snap.get("price"), (int, float)):
                        ni = snap.get("net_income_ttm")
                        snap = reprice(snap, price, pdate or "")
                        mc = snap.get("market_cap")
                        snap["pe"] = (
                            mc / ni
                            if isinstance(mc, (int, float)) and isinstance(ni, (int, float)) and ni > 0
                            else None
                        )
                    stats["repriced"] += 1
                snap["return_1y"] = _ret_1y(hist)
                rows.append(
                    {
                        "cik": u["cik"],
                        "ticker": u["ticker"],
                        "name": u["name"],
                        "rank": u["rank"],
                        "snapshot": snap,
                        "history": hist,
                        "fundamentals_at": fund_at,
                        "updated_at": datetime.now().isoformat(),
                    }
                )
                if len(rows) >= 50:
                    db.upsert("lite_companies", rows, on_conflict="cik")
                    rows = []
            except Exception as e:
                stats["errors"] += 1
                host = getattr(getattr(e, "request", None), "url", None)
                errors[u["ticker"]] = f"{type(e).__name__}: {e} ({getattr(host, 'host', '?')})"[:160]
        if rows:
            db.upsert("lite_companies", rows, on_conflict="cik")
        # companies since researched in full, or that left the top 500, drop out of the basic list
        keep = {u["cik"] for u in uni} - researched
        stale = [c for c in have if c not in keep]
        for i in range(0, len(stale), 100):
            db.delete_where("lite_companies", {"cik": f"in.({','.join(str(c) for c in stale[i : i + 100])})"})
    finally:
        sec.close()
        cboe.close()
    return {**stats, "errors_sample": dict(list(errors.items())[:8])}
