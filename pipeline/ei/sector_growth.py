"""Current revenue growth by sector, from SEC data (free).

Sector = the SPDR sector ETF the app maps each SEC industry code (SIC) to. For every SIC code in a
sector we list its companies (EDGAR), keep US-listed ones with at least $1B of revenue, and take the
median of last calendar year's revenue growth (XBRL "frames", one value per company).
"""

from __future__ import annotations

import logging
import re
import statistics
from datetime import date
from typing import Any

from ei.db import Db
from ei.http import get_with_retries
from ei.peers import REVENUE_TAGS, _frame, listed_map, sic_ciks
from ei.sec import SEC_LIMITER, SecClient
from ei.sectors import classify

log = logging.getLogger(__name__)
SIC_LIST_URL = "https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list"
MIN_REVENUE = 1e9
STALE_DAYS = 30
SECTOR_NAMES = {
    "XLK": "Technology",
    "XLC": "Communication services",
    "XLY": "Consumer discretionary",
    "XLP": "Consumer staples",
    "XLV": "Health care",
    "XLF": "Financials",
    "XLI": "Industrials",
    "XLE": "Energy",
    "XLB": "Materials",
    "XLU": "Utilities",
    "XLRE": "Real estate",
}


def sic_codes(sec: SecClient) -> list[int]:
    html = get_with_retries(sec._client, SIC_LIST_URL, limiter=SEC_LIMITER).text
    return sorted({int(c) for c in re.findall(r"<td[^>]*>\s*(\d{3,4})\s*</td>", html)})


def frame_year(sec: SecClient, year: int) -> dict[int, float]:
    """Full-calendar-year revenue per company: first revenue tag it reports, in priority order."""
    out: dict[int, float] = {}
    for tag in REVENUE_TAGS:
        for row in _frame(sec, tag, f"CY{year}"):
            out.setdefault(int(row["cik"]), float(row["val"]))
    return out


def quantile(xs: list[float], q: float) -> float:
    s = sorted(xs)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def growth_stats(ciks: set[int], listed: set[int], r0: dict[int, float], r1: dict[int, float]) -> dict[str, Any] | None:
    gs = [r1[c] / r0[c] - 1 for c in ciks if c in listed and r0.get(c, 0) >= MIN_REVENUE and r1.get(c, 0) > 0]
    gs = [g for g in gs if -0.6 < g < 2.0]  # drop restructurings / mega-acquisitions
    if len(gs) < 8:
        return None
    return {"median": statistics.median(gs), "p25": quantile(gs, 0.25), "p75": quantile(gs, 0.75), "n": len(gs)}


def refresh(settings: Any, only_stale: bool = True) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    today = date.today()
    existing = {r["etf"]: r for r in db.select("sector_growth", {"select": "*"})}
    if (
        only_stale
        and existing
        and all((today - date.fromisoformat(str(r["as_of"]))).days < STALE_DAYS for r in existing.values())
        and len(existing) >= len(SECTOR_NAMES)
    ):
        return {"skipped": "fresh"}
    sec = SecClient(settings.sec_user_agent)
    try:
        listed = set(listed_map(db))
        year = today.year - 1
        r1 = frame_year(sec, year)
        if len(r1) < 2000:  # last year not fully reported yet
            year -= 1
            r1 = frame_year(sec, year)
        r0 = frame_year(sec, year - 1)
        by_etf: dict[str, list[int]] = {}
        for code in sic_codes(sec):
            info = classify(code)
            by_etf.setdefault(info.etf, []).append(code)
        out: dict[str, Any] = {}
        for etf, codes in by_etf.items():
            if etf not in SECTOR_NAMES:
                continue
            ciks: set[int] = set()
            for code in codes:
                try:
                    ciks.update(sic_ciks(sec, str(code), max_pages=40))
                except Exception as e:  # one odd code shouldn't stop the sector
                    log.warning("SIC %s skipped: %s", code, e)
            st = growth_stats(ciks, listed, r0, r1)
            if not st:
                continue
            row = {
                "etf": etf,
                "as_of": today.isoformat(),
                "year": year,
                **st,
                "method": f"Median {year} vs {year - 1} revenue growth of {st['n']} US-listed {SECTOR_NAMES[etf].lower()} companies with $1B+ revenue (SEC XBRL frames; sector from SEC industry codes)",
            }
            db.upsert("sector_growth", [row], on_conflict="etf")
            out[etf] = {k: row[k] for k in ("median", "n")}
        return out
    finally:
        sec.close()
