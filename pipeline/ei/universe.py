"""Which stocks to load next: every US-listed operating company ranked by size (free, SEC).

Order = the SEC's own company ticker list, which it publishes sorted by market value (largest first).
Self-reported public float (10-K cover page) is NOT used for ordering — some filers report it at the
wrong scale (a $7B company showing $7T) — but having one confirms a US 10-K filer with full financials
(foreign 20-F filers and funds are left out).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from ei.db import Db
from ei.http import get_with_retries
from ei.sec import SEC_LIMITER, SecClient

log = logging.getLogger(__name__)

FRAME_URL = "https://data.sec.gov/api/xbrl/frames/dei/EntityPublicFloat/USD/CY{y}Q{q}I.json"
DB_LIMIT_BYTES = 400 * 1024 * 1024  # free tier is 500 MB; stop automatic loading with room to spare


def quarters_back(today: date, n: int) -> list[tuple[int, int]]:
    y, q = today.year, (today.month - 1) // 3 + 1
    out = []
    for _ in range(n):
        q -= 1
        if q == 0:
            y, q = y - 1, 4
        out.append((y, q))
    return out


def latest_floats(frames: list[list[dict[str, Any]]]) -> dict[int, tuple[float, str]]:
    """Newest public-float value per company across several quarterly frames."""
    best: dict[int, tuple[float, str]] = {}
    for rows in frames:
        for r in rows:
            cik, end, val = int(r["cik"]), str(r.get("end") or ""), r.get("val")
            if not val or val <= 0:
                continue
            if cik not in best or end > best[cik][1]:
                best[cik] = (float(val), end)
    return best


def pick_ticker(tickers: list[str]) -> str:
    """Prefer the common share ticker: no class suffix/dash, then shortest."""
    return sorted(tickers, key=lambda t: ("-" in t or "." in t, len(t), t))[0]


def refresh_universe(settings: Any) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    sec = SecClient(settings.sec_user_agent)
    try:
        frames = []
        for y, q in quarters_back(date.today(), 6):  # covers every fiscal-year end
            r = get_with_retries(sec._client, FRAME_URL.format(y=y, q=q), limiter=SEC_LIMITER)
            if r.status_code == 200:
                frames.append(r.json().get("data", []))
        floats = latest_floats(frames)
        all_tickers = sec.tickers()
        order: list[dict[str, Any]] = []
        seen: set[int] = set()
        for t in all_tickers:  # SEC order = market value, largest first
            if t["cik"] in seen:
                continue
            seen.add(t["cik"])
            order.append(t)
        by_cik: dict[int, list[str]] = {}
        for t in all_tickers:
            by_cik.setdefault(t["cik"], []).append(t["ticker"])
        ranked = [t for t in order if t["cik"] in floats]
        rows = [
            {
                "cik": t["cik"],
                "ticker": pick_ticker(by_cik[t["cik"]]),
                "name": t["name"],
                "public_float": floats[t["cik"]][0],
                "float_date": floats[t["cik"]][1],
                "rank": i + 1,
            }
            for i, t in enumerate(ranked)
        ]
        db.upsert("universe", rows, on_conflict="cik")
        return {"ranked": len(rows), "top": [r["ticker"] for r in rows[:10]]}
    finally:
        sec.close()


def autoload(settings: Any, n: int = 10) -> dict[str, Any]:
    """Load the next `n` largest companies that aren't loaded yet (SEC + prices; no AI, no Alpha Vantage)."""
    from ei.jobs import analyze

    db = Db(settings.supabase_url, settings.supabase_secret_key)
    size = int(db.rpc("db_size_bytes", {}))
    if size > DB_LIMIT_BYTES:
        return {"skipped": f"database is {size / 1e6:.0f} MB; automatic loading stops at {DB_LIMIT_BYTES / 1e6:.0f} MB"}
    loaded = {int(r["cik"]) for r in db.select("companies", {"select": "cik"})}
    queue = [
        r
        for r in db.select("universe", {"select": "cik,ticker,rank", "order": "rank", "limit": "1500"})
        if int(r["cik"]) not in loaded
    ]
    done: list[str] = []
    failed: list[str] = []
    for r in queue[:n]:
        try:
            res = analyze(settings, r["ticker"], primary=False, fetch_street=False)
            (done if res.get("ok") else failed).append(r["ticker"])
        except Exception as e:  # one bad filer shouldn't stop the queue
            log.warning("autoload %s failed: %s", r["ticker"], e)
            failed.append(r["ticker"])
    return {
        "loaded": done,
        "failed": failed,
        "next": [r["ticker"] for r in queue[n : n + 5]],
        "db_mb": round(size / 1e6),
    }
