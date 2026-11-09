"""Discounted cash flow model per company, from SEC financials. All math in code.

Free cash flow to the firm = EBIT × (1 − tax rate) + D&A − capex − increase in net working capital.
Ten forecast years, then a Gordon-growth terminal value. Discounted at WACC (CAPM cost of equity with
a beta measured from 5 years of weekly returns vs. the S&P 500). Every default assumption records where
it came from; the Excel download rebuilds the same model with live formulas so any input can be changed.
"""

from __future__ import annotations

import itertools
import re
import statistics
from datetime import date, timedelta
from typing import Any

from ei.db import Db
from ei.sector_growth import SECTOR_NAMES

VERSION = "dcf-v7"
YEARS = 10
GROWTH_DECAY = 0.7  # each year after year 2, growth keeps 70% of its gap to terminal growth
RISK_FREE = 0.0425  # 10-year US Treasury yield assumption (editable in the Excel model)
EQUITY_RISK_PREMIUM = 0.05
TERMINAL_GROWTH = 0.025  # base long-run growth (about nominal GDP); nudged up for fast-growing sectors
TERMINAL_MAX = 0.035
SECTOR_GROWTH_RANGE = (0.02, 0.15)


def sector_terminal(sector_g: float | None) -> float:
    """Terminal growth: 2.5%, plus 15% of how far the sector grows above that, capped at 3.5%
    (growing faster than the economy forever isn't possible, and values balloon past ~4%)."""
    if sector_g is None:
        return TERMINAL_GROWTH
    return max(TERMINAL_GROWTH, min(TERMINAL_MAX, TERMINAL_GROWTH + 0.15 * (sector_g - TERMINAL_GROWTH)))


def growth_path(g2: float, sector_g: float | None, terminal: float, years: int) -> list[float]:
    """Years 3..N. Growth closes 30% of its gap each year to a moving target that starts at the
    sector's current growth and glides to terminal growth by the last year."""
    out = []
    for t in range(3, years + 1):
        mid = terminal if sector_g is None else sector_g + (terminal - sector_g) * (t - 3) / (years - 3)
        out.append(mid + (g2 - mid) * GROWTH_DECAY ** (t - 2))
    return out


DEFAULT_TAX = 0.21
NOT_APPLICABLE = {"bank": "Banks", "insurer": "Insurers", "reit": "REITs"}

HIST_METRICS = [
    "revenue",
    "operating_income",
    "pretax_income",
    "income_tax",
    "da",
    "capex",
    "operating_cash_flow",
    "free_cash_flow",
    "sbc",
    "interest_expense",
    "current_assets",
    "current_liabilities",
    "cash",
    "debt_short",
    "debt_long_current",
    "total_debt",
    "diluted_shares",
]


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def avg(xs: list[float | None]) -> float | None:
    v = [x for x in xs if x is not None]
    return statistics.fmean(v) if v else None


def beta_from_prices(stock: list[dict[str, Any]], market: list[dict[str, Any]]) -> tuple[float | None, int]:
    """Weekly-return beta (every 5th trading day), Blume-adjusted toward 1, over the given window."""
    m = {r["date"]: float(r["adj_close"]) for r in market if r["adj_close"]}
    pts = [(r["date"], float(r["adj_close"]), m[r["date"]]) for r in stock if r["adj_close"] and r["date"] in m]
    pts = pts[::5]
    rs = [(b[1] / a[1] - 1, b[2] / a[2] - 1) for a, b in itertools.pairwise(pts)]
    if len(rs) < 100:
        return None, len(rs)
    xs, ys = [r[1] for r in rs], [r[0] for r in rs]
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    var = sum((x - mx) ** 2 for x in xs)
    if var == 0:
        return None, len(rs)
    raw = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / var
    return 0.67 * raw + 0.33, len(rs)


def nwc(h: dict[str, float | None]) -> float | None:
    """Operating working capital: current assets excl. cash − current liabilities excl. debt."""
    ca, cl = h.get("current_assets"), h.get("current_liabilities")
    if ca is None or cl is None:
        return None
    return (ca - (h.get("cash") or 0)) - (cl - (h.get("debt_short") or 0) - (h.get("debt_long_current") or 0))


def build(history: list[dict[str, Any]], a: dict[str, float]) -> dict[str, Any]:
    """Run the DCF from assumptions. `history` = fiscal years oldest→newest; uses the last one as base."""
    base = history[-1]
    rev = float(base["revenue"])
    rows = []
    for t in range(1, YEARS + 1):
        g = a[f"growth_{t}"]
        new_rev = rev * (1 + g)
        ebit = new_rev * a[f"margin_{t}"]
        nopat = ebit * (1 - a["tax_rate"])
        da = new_rev * a["da_pct"]
        capex = new_rev * a.get(f"capex_{t}", a.get("capex_pct", 0.0))
        d_nwc = (new_rev - rev) * a["nwc_pct"]
        fcf = nopat + da - capex - d_nwc
        rows.append(
            {
                "year": t,
                "revenue": new_rev,
                "growth": g,
                "ebit": ebit,
                "margin": a[f"margin_{t}"],
                "nopat": nopat,
                "da": da,
                "capex": capex,
                "d_nwc": d_nwc,
                "fcf": fcf,
            }
        )
        rev = new_rev
    w, g = a["wacc"], a["terminal_growth"]
    pv = [r["fcf"] / (1 + w) ** r["year"] for r in rows]
    for r, p in zip(rows, pv, strict=True):
        r["pv"] = p
    tv = rows[-1]["fcf"] * (1 + g) / (w - g) if w > g else None
    pv_tv = tv / (1 + w) ** YEARS if tv is not None else None
    ev = sum(pv) + (pv_tv or 0)
    equity = ev - a["net_debt"]
    per_share = equity / a["shares"] if a["shares"] else None
    ebitda_last = rows[-1]["ebit"] + rows[-1]["da"]
    return {
        "rows": rows,
        "sum_pv": sum(pv),
        "terminal_value": tv,
        "pv_terminal": pv_tv,
        "enterprise_value": ev,
        "equity_value": equity,
        "per_share": per_share,
        "upside": per_share / a["price"] - 1 if per_share and a.get("price") else None,
        "terminal_share": (pv_tv or 0) / ev if ev else None,
        "implied_exit_ev_ebitda": tv / ebitda_last if tv and ebitda_last > 0 else None,
    }


def sensitivity(history: list[dict[str, Any]], a: dict[str, float]) -> dict[str, Any]:
    waccs = [round(a["wacc"] + d, 4) for d in (-0.01, -0.005, 0, 0.005, 0.01)]
    gs = [round(a["terminal_growth"] + d, 4) for d in (-0.01, -0.005, 0, 0.005, 0.01)]
    grid = [
        [build(history, {**a, "wacc": w, "terminal_growth": g})["per_share"] if w > g else None for g in gs]
        for w in waccs
    ]
    return {"waccs": waccs, "growths": gs, "values": grid}


def defaults(
    db: Db, company: dict[str, Any], today: date
) -> tuple[str, str | None, list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Returns (status, note, history, assumptions) where each assumption = {value, label, source}."""
    cik = company["cik"]
    if company.get("sector_pack") in NOT_APPLICABLE:
        why = (
            "funds from operations (FFO/AFFO) and property values"
            if company["sector_pack"] == "reit"
            else "book value and returns on equity — see P/TBV and ROE in Peers"
        )
        return (
            "not_applicable",
            f"{NOT_APPLICABLE[company['sector_pack']]} are valued on {why}, not a standard free-cash-flow DCF.",
            [],
            {},
        )
    if (company.get("currency") or "USD") != "USD":
        return (
            "not_applicable",
            f"This company reports in {company['currency']} while its US shares trade in dollars (often as ADRs representing several shares). The DCF doesn't convert currencies or ADR ratios yet.",
            [],
            {},
        )
    rows = db.select(
        "metric_values",
        {
            "cik": f"eq.{cik}",
            "fiscal_period": "eq.FY",
            "metric": f"in.({','.join(HIST_METRICS)})",
            "select": "metric,fiscal_year,value,period_end",
            "order": "fiscal_year",
            "limit": "2000",
        },
    )
    by_year: dict[int, dict[str, Any]] = {}
    for r in rows:
        y = by_year.setdefault(
            int(r["fiscal_year"]), {"fiscal_year": int(r["fiscal_year"]), "period_end": r["period_end"]}
        )
        y[r["metric"]] = float(r["value"])
    hist = [by_year[y] for y in sorted(by_year) if by_year[y].get("revenue")][-6:]
    ebit_note = None
    if hist and not hist[-1].get("operating_income") and hist[-1].get("pretax_income") is not None:
        # Some filers (e.g. oil majors, IBM, REITs) report no operating income line: EBIT ≈ pre-tax income + interest expense.
        for y in hist:
            if y.get("operating_income") is None and y.get("pretax_income") is not None:
                y["operating_income"] = y["pretax_income"] + (y.get("interest_expense") or 0.0)
        ebit_note = "pre-tax income + interest expense (the company reports no operating income line)"
    if len(hist) < 3 or not hist[-1].get("operating_income"):
        return "insufficient", "Not enough annual SEC data (revenue and operating income) for a DCF.", hist, {}
    last = hist[-1]
    a: dict[str, dict[str, Any]] = {}

    def put(key: str, value: float, label: str, source: str) -> None:
        a[key] = {"value": value, "label": label, "source": source}

    # sector growth: median revenue growth of the company's sector last year (ei.sector_growth)
    sg_row = (
        db.select("sector_growth", {"etf": f"eq.{company.get('sector_etf')}", "select": "*"})
        if company.get("sector_etf")
        else []
    )
    sector_g = (
        clamp(float(sg_row[0]["median"]), *SECTOR_GROWTH_RANGE)
        if sg_row and sg_row[0].get("median") is not None
        else None
    )
    terminal = sector_terminal(sector_g)
    # growth: analysts' revenue consensus for the next two fiscal years, then fade toward sector growth and on to terminal growth
    est = db.select(
        "eps_estimates",
        {
            "cik": f"eq.{cik}",
            "horizon": "eq.fiscal year",
            "revenue_avg": "not.is.null",
            "select": "period_end,revenue_avg",
            "order": "period_end",
        },
    )
    last_end = date.fromisoformat(str(last["period_end"])[:10])
    future = [e for e in est if date.fromisoformat(str(e["period_end"])[:10]) > last_end + timedelta(days=60)]
    hist_cagr = (
        (last["revenue"] / hist[-4]["revenue"]) ** (1 / 3) - 1 if len(hist) >= 4 and hist[-4]["revenue"] > 0 else None
    )
    g1 = g2 = None
    src1 = src2 = ""
    if len(future) >= 2:
        # Annualized growth to the consensus two fiscal years out: robust to estimate rows that a data
        # provider labels with the wrong year (one year looks flat, the next jumps).
        cagr = (float(future[1]["revenue_avg"]) / last["revenue"]) ** 0.5 - 1
        g1 = g2 = cagr
        src1 = src2 = (
            f"Annualized growth from FY{last['fiscal_year']} actual revenue (SEC) to analysts' revenue consensus for FY ending {future[1]['period_end']} (Alpha Vantage)"
        )
    elif future:
        g1 = float(future[0]["revenue_avg"]) / last["revenue"] - 1
        src1 = f"Analyst revenue consensus for FY ending {future[0]['period_end']} (Alpha Vantage) vs. FY{last['fiscal_year']} actual"
    fallback = clamp(hist_cagr if hist_cagr is not None else 0.05, -0.05, 0.25)
    if g1 is None:
        g1, src1 = fallback, "3-year historical revenue growth rate (SEC), capped at 25%"
    if g2 is None:
        g2, src2 = (
            (g1 + terminal) / 2 if future else fallback,
            "Halfway between year-1 growth and terminal growth"
            if future
            else "3-year historical revenue growth rate (SEC)",
        )
    g1, g2 = clamp(g1, -0.3, 0.6), clamp(g2, -0.3, 0.6)
    put("growth_1", g1, "Revenue growth, year 1", src1)
    put("growth_2", g2, "Revenue growth, year 2", src2)
    if sector_g is not None:
        put(
            "sector_growth",
            sector_g,
            "Sector revenue growth (reference)",
            sg_row[0]["method"] + " — already built into years 3–10",
        )
    path_src = (
        "Fades from year-2 growth toward the sector's current growth, which glides to terminal growth by year 10 (the gap shrinks 30% a year)"
        if sector_g is not None
        else "Fades from year-2 growth toward terminal growth: the gap shrinks 30% each year"
    )
    for t, g in zip(range(3, YEARS + 1), growth_path(g2, sector_g, terminal, YEARS), strict=True):
        put(f"growth_{t}", g, f"Revenue growth, year {t}", path_src)
    # margin: trailing-twelve-months operating margin, held flat
    ttm = db.select(
        "metric_values",
        {
            "cik": f"eq.{cik}",
            "metric": "in.(revenue_ttm,operating_income_ttm)",
            "select": "metric,value,period_end",
            "order": "period_end.desc",
            "limit": "2",
        },
    )
    tv = {r["metric"]: float(r["value"]) for r in ttm}
    if ebit_note:
        m, msrc = (
            last["operating_income"] / last["revenue"],
            f"EBIT margin FY{last['fiscal_year']}, EBIT = {ebit_note} (SEC)",
        )
    elif tv.get("revenue_ttm") and "operating_income_ttm" in tv and len({r["period_end"] for r in ttm}) == 1:
        m, msrc = (
            tv["operating_income_ttm"] / tv["revenue_ttm"],
            f"Operating margin, last 12 months to {ttm[0]['period_end']} (SEC)",
        )
    else:
        m, msrc = last["operating_income"] / last["revenue"], f"Operating margin, FY{last['fiscal_year']} (SEC)"
    for t in range(1, YEARS + 1):
        put(f"margin_{t}", m, f"Operating (EBIT) margin, year {t}", msrc + "; held flat")
    recent = hist[-3:]
    rates = [
        y["income_tax"] / y["pretax_income"]
        for y in recent
        if y.get("income_tax") is not None and y.get("pretax_income") and y["pretax_income"] > 0
    ]
    put(
        "tax_rate",
        clamp(avg(rates) or DEFAULT_TAX, 0.10, 0.30) if rates else DEFAULT_TAX,
        "Tax rate",
        "3-year average effective tax rate (SEC), kept between 10% and 30%"
        if rates
        else "US federal statutory rate (no usable SEC tax data)",
    )
    put(
        "da_pct",
        avg([y["da"] / y["revenue"] for y in recent if y.get("da") is not None]) or 0.03,
        "D&A, % of revenue",
        "3-year average (SEC)",
    )
    capex0 = avg([y["capex"] / y["revenue"] for y in recent[-2:] if y.get("capex") is not None]) or 0.04
    target = a["da_pct"]["value"] * 1.2
    for t in range(1, YEARS + 1):
        if capex0 > target:
            put(
                f"capex_{t}",
                capex0 + (target - capex0) * (t - 1) / (YEARS - 1),
                f"Capex, % of revenue, year {t}",
                "Latest 2-year average (SEC), fading by year 10 to 1.2× D&A as the build-out matures",
            )
        else:
            put(f"capex_{t}", capex0, f"Capex, % of revenue, year {t}", "Latest 2-year average (SEC), held flat")
    nw = [(nwc(y), y["revenue"]) for y in hist[-4:]]
    ratios = [
        (b[0] - a_[0]) / (b[1] - a_[1])
        for a_, b in itertools.pairwise(nw)
        if a_[0] is not None and b[0] is not None and (b[1] - a_[1]) != 0
    ]
    put(
        "nwc_pct",
        clamp(avg(ratios) or 0.0, -0.2, 0.3) if ratios else 0.05,
        "Increase in working capital, % of revenue increase",
        "3-year average change in operating working capital ÷ change in revenue (SEC), kept between −20% and 30%"
        if ratios
        else "Assumption (no usable SEC working-capital data)",
    )
    # capital structure and WACC
    v = company.get("valuation") or {}
    price = float(v.get("price") or 0)
    lv: dict[str, tuple[float, str]] = {}
    for metric in ("cash", "total_debt", "diluted_shares"):
        got = db.select(
            "metric_values",
            {
                "cik": f"eq.{cik}",
                "metric": f"eq.{metric}",
                "select": "value,period_end",
                "order": "period_end.desc",
                "limit": "1",
            },
        )
        if got:
            lv[metric] = (float(got[0]["value"]), str(got[0]["period_end"]))
    cash = lv.get("cash", (0.0, ""))
    debt = lv.get("total_debt", (0.0, ""))
    shares = lv.get("diluted_shares", (0.0, ""))
    shares_src = f"Latest diluted share count, period ending {shares[1]} (SEC)"
    stale = not shares[1] or date.fromisoformat(shares[1][:10]) < today - timedelta(days=400)
    if stale and price and v.get("market_cap"):
        shares = (float(v["market_cap"]) / price, "")
        shares_src = f"{v.get('shares_source', 'Cover page shares outstanding')} (SEC) — no recent diluted share count"
    mcap = float(v.get("market_cap") or price * shares[0])
    put("price", price, "Share price", f"Close on {v.get('price_date')} (Tiingo)")
    put("shares", shares[0], "Diluted shares", shares_src)
    put("net_debt", debt[0] - cash[0], "Net debt (debt − cash)", f"Total debt {debt[1]} minus cash {cash[1]} (SEC)")
    put("risk_free", RISK_FREE, "Risk-free rate", "10-year US Treasury yield assumption — update to today's rate")
    px = db.select(
        "prices",
        {
            "ticker": f"eq.{company['ticker']}",
            "date": f"gte.{today - timedelta(days=5 * 365)}",
            "select": "date,adj_close",
            "order": "date",
            "limit": "1400",
        },
    )
    spy = db.select(
        "prices",
        {
            "ticker": "eq.SPY",
            "date": f"gte.{today - timedelta(days=5 * 365)}",
            "select": "date,adj_close",
            "order": "date",
            "limit": "1400",
        },
    )
    b, nweeks = beta_from_prices(px, spy)
    put(
        "beta",
        clamp(b, 0.5, 2.0) if b else 1.0,
        "Beta",
        f"{nweeks} weekly returns vs. S&P 500 (SPY), Blume-adjusted, kept between 0.5 and 2.0"
        if b
        else "Market average (not enough price history)",
    )
    put("erp", EQUITY_RISK_PREMIUM, "Equity risk premium", "Long-run US equity risk premium assumption")
    ie = last.get("interest_expense")
    if ie and debt[0] > 0:
        kd, kd_src = clamp(ie / debt[0], 0.02, 0.12), f"FY{last['fiscal_year']} interest expense ÷ total debt (SEC)"
    else:
        kd, kd_src = RISK_FREE + 0.015, "Risk-free rate + 1.5% (no usable SEC interest data)"
    put("cost_of_debt", kd, "Pre-tax cost of debt", kd_src)
    ke = RISK_FREE + a["beta"]["value"] * EQUITY_RISK_PREMIUM
    we = mcap / (mcap + max(debt[0], 0)) if mcap > 0 else 1.0
    wacc = we * ke + (1 - we) * kd * (1 - a["tax_rate"]["value"])
    put("equity_weight", we, "Equity share of capital", "Market value of equity ÷ (equity + total debt)")
    put(
        "wacc",
        wacc,
        "WACC (discount rate)",
        f"Cost of equity {ke:.1%} (risk-free + beta × premium) and after-tax cost of debt, weighted by market value",
    )
    put(
        "terminal_growth",
        terminal,
        "Terminal growth",
        "Long-run growth after year 10: 2.5% (about nominal GDP)"
        + (
            f", plus 15% of the sector's excess growth, capped at 3.5% ({SECTOR_NAMES.get(str(company.get('sector_etf')), 'sector')} grows {sector_g:.1%})"
            if sector_g is not None
            else ""
        ),
    )
    note = None
    if m <= 0:
        note = "Operating margin is negative, so the DCF value isn't meaningful until the company is profitable."
    return "ok", note, hist, a


METHODS = {
    "model": "Free cash flow to the firm = EBIT × (1 − tax rate) + depreciation & amortization − capital expenditures − increase in operating working capital. Ten forecast years, end-of-year discounting at WACC, terminal value = year-10 free cash flow × (1 + g) ÷ (WACC − g).",
    "fade": "Years 3–10 revenue growth fades toward a target: each year it closes 30% of the gap. The target starts at the sector's current growth rate and glides to terminal growth by year 10, so companies in fast-growing sectors keep above-GDP growth for longer.",
    "sector": "Sector growth = median last-calendar-year revenue growth of US-listed companies with $1B+ revenue in the same sector (SEC industry codes mapped to S&P sectors; SEC XBRL frames). Refreshed monthly. Terminal growth = 2.5% + 15% of the sector's growth above 2.5%, capped at 3.5%.",
    "capex": "When capex is well above depreciation (a build-out phase), it fades in equal steps to 1.2× D&A by year 10; otherwise it is held at the latest 2-year average.",
    "beta": "Beta from weekly returns over 5 years vs. SPY (S&P 500 ETF), adjusted toward 1 (0.67 × measured + 0.33), kept between 0.5 and 2.0.",
    "wacc": "WACC = equity weight × (risk-free + beta × equity risk premium) + debt weight × pre-tax cost of debt × (1 − tax rate); weights from market value of equity and book value of debt.",
    "macro": "Market assumptions (not from company filings): 10-year Treasury yield 4.25%, equity risk premium 5.0%, base long-run growth 2.5% (about nominal GDP). Update them in the Excel model.",
    "nwc": "Operating working capital = (current assets − cash) − (current liabilities − short-term debt − current portion of long-term debt).",
}
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def footnotes(
    db: Db, company: dict[str, Any], hist: list[dict[str, Any]], a: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, list[int]], dict[str, list[int]]]:
    """Numbered sources for every assumption and every historical year: SEC filings (with links),
    data providers, and the model's methods. Returns (footnotes, notes per assumption, notes per FY)."""
    filings = db.select(
        "filings",
        {
            "cik": f"eq.{company['cik']}",
            "form": "in.(10-K,10-K/A,10-Q,10-Q/A,20-F,40-F)",
            "select": "form,report_date,filed_date,url,accession",
            "order": "filed_date.desc",
            "limit": "200",
        },
    )
    notes: list[dict[str, Any]] = []
    index: dict[str, int] = {}

    def add(key: str, text: str, url: str | None = None) -> int:
        if key not in index:
            notes.append({"id": len(notes) + 1, "text": text, "url": url})
            index[key] = len(notes)
        return index[key]

    def filing(period_end: str | None) -> int | None:
        if not period_end:
            return None
        pe = date.fromisoformat(period_end[:10])
        cands = [
            f
            for f in filings
            if f.get("report_date")
            and abs((date.fromisoformat(str(f["report_date"])[:10]) - pe).days) <= 15
            and not f["form"].endswith("/A")
        ]
        if not cands:
            return None
        f = sorted(cands, key=lambda x: (x["form"] not in {"10-K", "20-F", "40-F"}, str(x["filed_date"])))[0]
        idx_url = f["url"].rsplit("/", 1)[0] + "/" if f.get("url") else None
        return add(
            f"filing:{f['accession']}",
            f"{f['form']} for the period ending {f['report_date']}, filed {f['filed_date']} (SEC EDGAR)",
            idx_url,
        )

    fy_notes: dict[str, list[int]] = {}
    for y in hist:
        n = filing(str(y.get("period_end")))
        fy_notes[str(y["fiscal_year"])] = [n] if n else []
    last3 = [i for y in hist[-3:] for i in fy_notes.get(str(y["fiscal_year"]), [])]
    last = fy_notes.get(str(hist[-1]["fiscal_year"]), []) if hist else []
    av = add(
        "av",
        "Analyst consensus estimates (Alpha Vantage EARNINGS_ESTIMATES): revenue and EPS for upcoming fiscal years and quarters.",
    )
    tiingo = add("tiingo", "Daily share prices (Tiingo), split-adjusted.")
    model = add("m:model", METHODS["model"])

    by_key: dict[str, list[int]] = {}
    for k, x in a.items():
        src = x.get("source", "")
        dates = _DATE.findall(src)
        ids: list[int] = []
        if k.startswith("growth_"):
            ids = ([av] if "Alpha Vantage" in src else []) + last
            if k not in {"growth_1", "growth_2"}:
                ids.append(add("m:fade", METHODS["fade"]))
        elif k.startswith("margin_"):
            n = filing(dates[0]) if dates else None
            ids = [n] if n else last
        elif k.startswith("capex_"):
            ids = [*last3, add("m:capex", METHODS["capex"])]
        elif k in {"tax_rate", "da_pct"}:
            ids = last3
        elif k == "nwc_pct":
            ids = [*last3, add("m:nwc", METHODS["nwc"])]
        elif k == "price":
            ids = [tiingo]
        elif k in {"shares", "net_debt"}:
            ids = [i for i in (filing(d) for d in dates) if i] or last
        elif k == "beta":
            ids = [tiingo, add("m:beta", METHODS["beta"])]
        elif k in {"risk_free", "erp"}:
            ids = [add("m:macro", METHODS["macro"])]
        elif k == "terminal_growth":
            ids = [add("m:macro", METHODS["macro"])] + (
                [add("m:sector", METHODS["sector"])] if "sector_growth" in a else []
            )
        elif k == "sector_growth":
            ids = [add("m:sector", METHODS["sector"])]
        elif k == "cost_of_debt":
            ids = last if "SEC" in src else [add("m:macro", METHODS["macro"])]
        elif k in {"equity_weight", "wacc"}:
            ids = [add("m:wacc", METHODS["wacc"]), tiingo]
        by_key[k] = list(dict.fromkeys(ids))
    by_key["_model"] = [model]
    return notes, by_key, fy_notes


def run_dcf(db: Db, company: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    status, note, hist, a = defaults(db, company, today)
    row: dict[str, Any] = {
        "cik": company["cik"],
        "version": VERSION,
        "status": status,
        "note": note,
        "history": hist,
        "assumptions": a,
        "result": None,
        "created_at": today.isoformat(),
    }
    if status == "ok":
        vals = {k: float(x["value"]) for k, x in a.items()}
        res = build(hist, vals)
        res["sensitivity"] = sensitivity(hist, vals)
        fns, by_key, fy_notes = footnotes(db, company, hist, a)
        res["footnotes"] = fns
        res["fy_notes"] = fy_notes
        for k, ids in by_key.items():
            if k in a:
                a[k]["notes"] = ids
        res["model_notes"] = by_key["_model"]
        row["result"] = res
    db.upsert("dcf_models", [row], on_conflict="cik")
    return {
        "status": status,
        "per_share": (row["result"] or {}).get("per_share"),
        "upside": (row["result"] or {}).get("upside"),
    }


def run_all(settings: Any, tickers: list[str] | None = None) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    etfs = {r["sector_etf"] for r in db.select("companies", {"select": "sector_etf"}) if r.get("sector_etf")} | {"SPY"}
    out = {}
    for c in db.select("companies", {"select": "*"}):
        if c["ticker"] in etfs or (tickers and c["ticker"] not in tickers):
            continue
        try:
            out[c["ticker"]] = run_dcf(db, c)
        except Exception as e:  # one company's odd data shouldn't stop the rest
            out[c["ticker"]] = {"status": "error", "error": f"{type(e).__name__}: {e}"[:200]}
    return out
