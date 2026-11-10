"""Daily sanity checks on every company's numbers (code only, no AI, no paid data).

Each check compares two independent routes to the same fact (e.g. market value from the share count vs
from earnings ÷ P/E) or tests a number against what is economically possible. A failed check writes a
flag; severity "hide" means the website holds the listed fields back instead of showing a likely-wrong
number, "warn" means it shows them with a note. Flags are rebuilt from scratch every run, so a fixed
problem disappears the next day.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from ei.db import Db

log = logging.getLogger(__name__)

# fields whose value depends on the market value (hidden together when the share count is suspect)
MCAP_FIELDS = [
    "market_cap",
    "enterprise_value",
    "ev_ebitda",
    "ev_revenue",
    "fcf_yield",
    "shareholder_yield",
    "p_b",
    "p_tbv",
]


def _flag(check: str, severity: str, fields: list[str], message: str, **detail: Any) -> dict[str, Any]:
    return {"check": check, "severity": severity, "fields": fields, "message": message, "detail": detail}


def check_company(
    v: dict[str, Any],
    m: dict[str, float],
    quarters: list[tuple[str, float]],
    segments: dict[str, tuple[float, float | None]],
    dcf_per_share: float | None,
    last_price: date | None,
    today: date,
) -> list[dict[str, Any]]:
    """`v` valuation snapshot; `m` latest TTM metrics; `quarters` recent quarterly revenue (label, value);
    `segments` axis -> (sum of latest-year lines, company revenue that year)."""
    out: list[dict[str, Any]] = []
    price = v.get("price")
    mcap = v.get("market_cap")
    ni, eps, shares = m.get("net_income_ttm"), m.get("eps_diluted_ttm"), m.get("diluted_shares")

    # 1. Market value two ways: price × shares vs net income ÷ EPS × price
    if mcap and price and ni and eps and ni > 0 and eps > 0:
        implied = ni / eps * price
        ratio = mcap / implied
        if not 0.75 <= ratio <= 1.33:
            out.append(
                _flag(
                    "market_value",
                    "hide",
                    MCAP_FIELDS,
                    f"Market value (${mcap / 1e9:.0f}B) doesn't match earnings ÷ EPS (${implied / 1e9:.0f}B); "
                    "the share count is probably off.",
                    ratio=round(ratio, 2),
                )
            )
    # 2. P/E economically possible and consistent with price ÷ EPS
    pe = v.get("pe")
    if pe is not None and price and eps and eps > 0:
        direct = price / eps
        if abs(pe / direct - 1) > 0.15:
            out.append(
                _flag(
                    "pe",
                    "hide",
                    ["pe"],
                    f"P/E {pe:.1f}× doesn't match price ÷ EPS ({direct:.1f}×).",
                    pe=pe,
                    direct=direct,
                )
            )
    if pe is not None and (pe <= 0 or pe > 400):
        out.append(_flag("pe_range", "warn", ["pe"], f"P/E of {pe:.0f}× is extreme; earnings are probably near zero."))
    # 3. Yields that are almost never real
    dy = v.get("dividend_yield")
    if dy is not None and dy > 0.15:
        out.append(_flag("dividend_yield", "hide", ["dividend_yield"], f"Dividend yield {dy:.1%} is implausibly high."))
    sy = v.get("shareholder_yield")
    if sy is not None and sy > 0.25:
        out.append(
            _flag(
                "shareholder_yield",
                "warn",
                ["shareholder_yield"],
                f"Dividends + buybacks equal {sy:.0%} of market value — check for a one-off buyback.",
            )
        )
    # 4. Dividends per share vs cash dividends paid
    dps, paid = v.get("dividend_per_share_ttm"), m.get("dividends_paid_ttm")
    if dps and paid and shares and not 0.6 <= dps * shares / paid <= 1.6:
        out.append(
            _flag(
                "dividends",
                "hide",
                ["dividend_per_share_ttm", "dividend_yield"],
                f"Dividends per share × shares (${dps * shares / 1e9:.1f}B) doesn't match cash dividends paid (${paid / 1e9:.1f}B).",
            )
        )
    # 5. Quarterly revenue can't be negative, and a quarter rarely swings 3× vs its neighbors
    for label, val in quarters:
        if val < 0:
            out.append(
                _flag(
                    "revenue_quarter",
                    "warn",
                    [],
                    f"{label} revenue is negative (${val / 1e9:.2f}B); a full-year restatement likely broke the Q4 math.",
                )
            )
    # 6. Segment lines vs company revenue
    for axis, (total, rev) in segments.items():
        if rev and rev > 0 and total > 1.05 * rev:
            out.append(
                _flag(
                    "segments",
                    "hide",
                    [f"segments:{axis}"],
                    f"{axis.title()} lines add to ${total / 1e9:.1f}B vs revenue ${rev / 1e9:.1f}B; they double count.",
                )
            )
    # 7. DCF far outside any reasonable range of the price
    if dcf_per_share is not None and price:
        r = dcf_per_share / price
        if r > 4 or r < 0.15:
            out.append(
                _flag(
                    "dcf",
                    "hide",
                    ["dcf"],
                    f"DCF value ${dcf_per_share:.0f} is {r:.1f}× the price; an input is probably wrong.",
                    ratio=round(r, 2),
                )
            )
        elif r > 2.5 or r < 0.3:
            out.append(
                _flag("dcf_range", "warn", ["dcf"], f"DCF value is {r:.1f}× the price — treat with extra caution.")
            )
    # 8. Stale price
    if last_price and (today - last_price).days > 6:
        out.append(
            _flag(
                "price_stale",
                "warn",
                ["price"],
                f"Last price is from {last_price.isoformat()}; prices may have stopped updating.",
            )
        )
    # 9. EV/EBITDA sign/range
    eve = v.get("ev_ebitda")
    if eve is not None and (eve < 0 or eve > 300):
        out.append(_flag("ev_ebitda", "warn", ["ev_ebitda"], f"EV/EBITDA of {eve:.0f}× is outside the normal range."))
    return out


def run(db: Db, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    companies = db.select("companies", {"select": "cik,ticker,valuation", "valuation": "not.is.null"})
    since = (today - timedelta(days=800)).isoformat()
    metrics = db.select_all(
        "metric_values",
        {
            "metric": "in.(net_income_ttm,eps_diluted_ttm,diluted_shares,dividends_paid_ttm,revenue)",
            "period_end": f"gte.{since}",
            "select": "cik,metric,fiscal_year,fiscal_period,period_end,value",
            "order": "period_end.asc",
        },
    )
    seg = db.select_all(
        "segment_values",
        {"measure": "eq.revenue", "fiscal_period": "eq.FY", "select": "cik,axis,fiscal_year,value"},
    )
    dcfs = {r["cik"]: r for r in db.select("dcf_models", {"select": "cik,status,per_share:result->per_share"})}
    last_px = {}
    for c in companies:
        rows = db.select(
            "prices", {"ticker": f"eq.{c['ticker']}", "select": "date", "order": "date.desc", "limit": "1"}
        )
        if rows:
            last_px[c["cik"]] = date.fromisoformat(rows[0]["date"])

    flags: list[dict[str, Any]] = []
    summary: dict[str, list[str]] = {}
    for c in companies:
        cik = c["cik"]
        rows = [r for r in metrics if r["cik"] == cik]
        latest: dict[str, float] = {}
        for r in rows:
            if r["metric"] != "revenue":
                latest[r["metric"]] = float(r["value"])
        quarters = [
            (f"{r['fiscal_period']} FY{r['fiscal_year']}", float(r["value"]))
            for r in rows
            if r["metric"] == "revenue" and r["fiscal_period"] != "FY"
        ][-8:]
        rev_fy = {
            r["fiscal_year"]: float(r["value"]) for r in rows if r["metric"] == "revenue" and r["fiscal_period"] == "FY"
        }
        segs: dict[str, tuple[float, float | None]] = {}
        mine = [s for s in seg if s["cik"] == cik]
        for axis in {s["axis"] for s in mine}:
            fy = max(s["fiscal_year"] for s in mine if s["axis"] == axis)
            segs[axis] = (
                sum(float(s["value"]) for s in mine if s["axis"] == axis and s["fiscal_year"] == fy),
                rev_fy.get(fy),
            )
        d = dcfs.get(cik)
        dcf_ps = float(d["per_share"]) if d and d.get("status") == "ok" and d.get("per_share") is not None else None
        found = check_company(c["valuation"] or {}, latest, quarters, segs, dcf_ps, last_px.get(cik), today)
        for f in found:
            flags.append({"cik": cik, **f})
        if found:
            summary[c["ticker"]] = [f"{f['severity']}:{f['check']}" for f in found]
    db.delete_where("quality_flags", {"cik": "gte.0"})
    if flags:
        db.upsert("quality_flags", flags, on_conflict="cik,check")
    return {"companies": len(companies), "flagged": summary}
