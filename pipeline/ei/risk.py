"""Stats & risk for each stock, computed in code from daily prices and SEC financials (free; no AI).

Price statistics use split- and dividend-adjusted closes. "Market" = SPY; "sector" = the company's
SPDR sector ETF. Annualization assumes 252 trading days. Risk-free rate matches the DCF (4.25%).
"""

from __future__ import annotations

import logging
import math
import statistics
from bisect import bisect_left
from datetime import date, timedelta
from typing import Any

from ei.calls.run import _series
from ei.db import Db

log = logging.getLogger(__name__)

TRADING_DAYS = 252
RISK_FREE = 0.0425

Series = list[tuple[date, float]]


def returns(s: Series) -> list[tuple[date, float]]:
    return [(s[i][0], s[i][1] / s[i - 1][1] - 1) for i in range(1, len(s)) if s[i - 1][1] > 0]


def window(r: list[tuple[date, float]], end: date, days: int) -> list[tuple[date, float]]:
    start = end - timedelta(days=days)
    return [x for x in r if x[0] > start]


def ann_vol(xs: list[float]) -> float | None:
    return statistics.stdev(xs) * math.sqrt(TRADING_DAYS) if len(xs) > 20 else None


def aligned(a: list[tuple[date, float]], b: list[tuple[date, float]]) -> tuple[list[float], list[float]]:
    bm = dict(b)
    pairs = [(x, bm[d]) for d, x in a if d in bm]
    return [p[0] for p in pairs], [p[1] for p in pairs]


def beta_corr(a: list[float], m: list[float]) -> tuple[float | None, float | None]:
    if len(a) < 40:
        return None, None
    vm = statistics.variance(m)
    if vm == 0:
        return None, None
    cov = statistics.covariance(a, m)
    return cov / vm, statistics.correlation(a, m)


def max_drawdown(s: Series) -> tuple[float, date | None, date | None]:
    """Largest peak-to-trough fall, with the peak and trough dates."""
    peak, peak_d, worst, w_peak, w_trough = -math.inf, None, 0.0, None, None
    for d, p in s:
        if p > peak:
            peak, peak_d = p, d
        dd = p / peak - 1
        if dd < worst:
            worst, w_peak, w_trough = dd, peak_d, d
    return worst, w_peak, w_trough


def sharpe_sortino(xs: list[float]) -> tuple[float | None, float | None]:
    if len(xs) < 60:
        return None, None
    rf = RISK_FREE / TRADING_DAYS
    ex = [x - rf for x in xs]
    mu = statistics.mean(ex)
    sd = statistics.stdev(ex)
    down = [min(0.0, x) for x in ex]
    dd = math.sqrt(sum(d * d for d in down) / len(down))
    k = math.sqrt(TRADING_DAYS)
    return (mu / sd * k if sd else None), (mu / dd * k if dd else None)


def var_cvar(xs: list[float], level: float = 0.95) -> tuple[float | None, float | None]:
    """Historical 1-day value at risk and expected shortfall, as positive loss fractions."""
    if len(xs) < 100:
        return None, None
    srt = sorted(xs)
    k = max(1, int(len(srt) * (1 - level)))
    return -srt[k - 1], -statistics.mean(srt[:k])


def moments(xs: list[float]) -> tuple[float | None, float | None]:
    if len(xs) < 60:
        return None, None
    mu, sd = statistics.mean(xs), statistics.pstdev(xs)
    if not sd:
        return None, None
    n = len(xs)
    skew = sum((x - mu) ** 3 for x in xs) / n / sd**3
    kurt = sum((x - mu) ** 4 for x in xs) / n / sd**4 - 3
    return skew, kurt


def histogram(xs: list[float], lo: float = -0.08, hi: float = 0.08, step: float = 0.005) -> list[list[float]]:
    """Daily-return histogram, edges clipped into the end buckets: [[bucket_start, count], ...]."""
    n = round((hi - lo) / step)
    counts = [0] * n
    for x in xs:
        i = min(n - 1, max(0, int((x - lo) // step)))
        counts[i] += 1
    return [[round(lo + i * step, 4), c] for i, c in enumerate(counts)]


def monthly(s: Series) -> list[tuple[date, float]]:
    """Month-end closes → monthly returns."""
    last: dict[tuple[int, int], tuple[date, float]] = {}
    for d, p in s:
        last[(d.year, d.month)] = (d, p)
    pts = [last[k] for k in sorted(last)]
    return [(pts[i][0], pts[i][1] / pts[i - 1][1] - 1) for i in range(1, len(pts))]


def capture(a: list[float], m: list[float]) -> tuple[float | None, float | None]:
    """Up/down capture vs the market, from monthly returns (100% = moves one-for-one)."""
    up = [(x, y) for x, y in zip(a, m, strict=True) if y > 0]
    dn = [(x, y) for x, y in zip(a, m, strict=True) if y < 0]

    def ratio(p: list[tuple[float, float]]) -> float | None:
        if len(p) < 6:
            return None
        ga = math.prod(1 + x for x, _ in p) ** (1 / len(p)) - 1
        gm = math.prod(1 + y for _, y in p) ** (1 / len(p)) - 1
        return ga / gm if gm else None

    return ratio(up), ratio(dn)


def seasonality(mr: list[tuple[date, float]]) -> list[dict[str, Any]]:
    out = []
    for m in range(1, 13):
        xs = [r for d, r in mr if d.month == m]
        if xs:
            out.append(
                {
                    "month": m,
                    "avg": statistics.mean(xs),
                    "pct_up": sum(1 for x in xs if x > 0) / len(xs),
                    "years": len(xs),
                }
            )
    return out


def rolling_vol(r: list[tuple[date, float]], days: int = 63, every: int = 5) -> list[list[Any]]:
    out = []
    for i in range(days, len(r), every):
        xs = [x for _, x in r[i - days : i]]
        out.append([r[i - 1][0].isoformat(), round(statistics.stdev(xs) * math.sqrt(TRADING_DAYS), 4)])
    return out


def drawdown_series(s: Series, every: int = 5) -> list[list[Any]]:
    peak = -math.inf
    out = []
    for i, (d, p) in enumerate(s):
        peak = max(peak, p)
        if i % every == 0 or i == len(s) - 1:
            out.append([d.isoformat(), round(p / peak - 1, 4)])
    return out


def earnings_moves(s: Series, events: list[dict[str, Any]], sector: Series | None = None) -> list[dict[str, Any]]:
    """Stock move on each earnings report: from the close before the news to the close after it.
    Reports before the open move that day; after the close, the next day."""
    dates = [d for d, _ in s]
    px = [p for _, p in s]
    out = []
    for e in events:
        rd = date.fromisoformat(str(e["report_date"])[:10])
        after_close = (e.get("report_time") or "").lower().startswith("post")
        i = bisect_left(dates, rd)
        if i >= len(dates) or i == 0:
            continue
        j = i + 1 if (after_close and dates[i] == rd) else i  # first close that reflects the news
        if j >= len(dates):
            continue
        move = px[j] / px[j - 1] - 1
        out.append(
            {"date": rd.isoformat(), "quarter": f"FY{e['fiscal_year']}Q{e['fiscal_quarter']}", "move": round(move, 4)}
        )
    return sorted(out, key=lambda x: x["date"], reverse=True)


def piotroski(fy: dict[str, dict[int, float]]) -> dict[str, Any] | None:
    """Piotroski F-score (0–9): nine pass/fail checks on profitability, leverage/liquidity and efficiency,
    latest fiscal year vs the year before. 7–9 = strong; 0–3 = weak."""
    years = sorted(set(fy.get("total_assets", {})) & set(fy.get("net_income", {})))
    if len(years) < 3:
        return None
    y, p, pp = years[-1], years[-2], years[-3]

    def g(k: str, yr: int) -> float | None:
        return fy.get(k, {}).get(yr)

    ta, ta_p, ta_pp = g("total_assets", y), g("total_assets", p), g("total_assets", pp)
    ni, ni_p = g("net_income", y), g("net_income", p)
    ocf = g("operating_cash_flow", y)
    checks: list[tuple[str, bool | None]] = []
    roa = ni / ta_p if ni is not None and ta_p else None
    roa_p = ni_p / ta_pp if ni_p is not None and ta_pp else None
    checks.append(("Profitable (positive net income)", None if ni is None else ni > 0))
    checks.append(("Positive operating cash flow", None if ocf is None else ocf > 0))
    checks.append(("Return on assets improved", None if roa is None or roa_p is None else roa > roa_p))
    checks.append(("Cash flow exceeds net income (quality earnings)", None if ocf is None or ni is None else ocf > ni))
    debt, debt_p = g("total_debt", y), g("total_debt", p)
    lev = debt / ta if debt is not None and ta else None
    lev_p = debt_p / ta_p if debt_p is not None and ta_p else None
    checks.append(("Debt-to-assets fell", None if lev is None or lev_p is None else lev <= lev_p))
    cr, cr_p = g("current_ratio", y), g("current_ratio", p)
    checks.append(("Current ratio improved", None if cr is None or cr_p is None else cr > cr_p))
    sh, sh_p = g("diluted_shares", y), g("diluted_shares", p)
    checks.append(("No net share issuance", None if sh is None or sh_p is None else sh <= sh_p * 1.005))
    gm, gm_p = g("gross_margin", y), g("gross_margin", p)
    checks.append(("Gross margin improved", None if gm is None or gm_p is None else gm > gm_p))
    rev, rev_p = g("revenue", y), g("revenue", p)
    at = rev / ta_p if rev and ta_p else None
    at_p = rev_p / ta_pp if rev_p and ta_pp else None
    checks.append(("Asset turnover improved", None if at is None or at_p is None else at > at_p))
    known = [c for c in checks if c[1] is not None]
    if len(known) < 7:
        return None
    return {
        "score": sum(1 for _, ok in known if ok),
        "out_of": len(known),
        "fiscal_year": y,
        "checks": [{"label": label, "pass": ok} for label, ok in checks],
    }


def fundamental_risk(fy: dict[str, dict[int, float]]) -> dict[str, Any]:
    def last(k: str) -> tuple[int, float] | None:
        s = fy.get(k) or {}
        return (max(s), s[max(s)]) if s else None

    out: dict[str, Any] = {"piotroski": piotroski(fy)}
    oi, ie = last("operating_income"), last("interest_expense")
    out["interest_coverage"] = oi[1] / ie[1] if oi and ie and ie[1] > 0 and oi[0] == ie[0] else None
    nde = last("net_debt_to_ebitda")
    out["net_debt_to_ebitda"] = nde[1] if nde else None
    sbc, rev = last("sbc"), last("revenue")
    out["sbc_pct_revenue"] = sbc[1] / rev[1] if sbc and rev and rev[1] and sbc[0] == rev[0] else None
    sh = fy.get("diluted_shares") or {}
    ys = sorted(sh)
    out["share_change_1y"] = sh[ys[-1]] / sh[ys[-2]] - 1 if len(ys) >= 2 and sh[ys[-2]] else None
    out["share_change_3y"] = (sh[ys[-1]] / sh[ys[-4]]) ** (1 / 3) - 1 if len(ys) >= 4 and sh[ys[-4]] else None
    return out


def compute(
    stock: Series, market: Series, sector: Series | None, events: list[dict[str, Any]], fy: dict[str, dict[int, float]]
) -> dict[str, Any]:
    if len(stock) < 60:
        return {"error": "not enough price history"}
    end = stock[-1][0]
    r, rm = returns(stock), returns(market)
    rs = returns(sector) if sector else []
    r1, r3 = window(r, end, 365), window(r, end, 365 * 3)
    x1 = [x for _, x in r1]
    a1, m1 = aligned(r1, window(rm, end, 365))
    a3, m3 = aligned(r3, window(rm, end, 365 * 3))
    b1, c1 = beta_corr(a1, m1)
    b3, c3 = beta_corr(a3, m3)
    bs1, cs1 = beta_corr(*aligned(r1, window(rs, end, 365))) if rs else (None, None)
    s1, so1 = sharpe_sortino(x1)
    s3, so3 = sharpe_sortino([x for _, x in r3])
    sm1, _ = sharpe_sortino(m1)
    var, cvar = var_cvar(x1)
    skew, kurt = moments(x1)
    p1 = [x for x in stock if x[0] > end - timedelta(days=365)]
    p5 = [x for x in stock if x[0] > end - timedelta(days=365 * 5)]
    mdd1, pk1, tr1 = max_drawdown(p1)
    mdd5, pk5, tr5 = max_drawdown(p5)
    mddall, pka, tra = max_drawdown(stock)
    hi52 = max(p for _, p in p1)
    mrs = monthly([x for x in stock if x[0] > end - timedelta(days=365 * 3)])
    mrm = monthly([x for x in market if x[0] > end - timedelta(days=365 * 3)])
    ma, mm = aligned(mrs, mrm)
    upc, dnc = capture(ma, mm)
    best = sorted(r1, key=lambda x: -x[1])[:3]
    worst = sorted(r1, key=lambda x: x[1])[:3]
    em = earnings_moves(stock, events)
    recent_em = [abs(e["move"]) for e in em[:8]]
    vol30 = ann_vol([x for _, x in window(r, end, 30)])
    vol1y = ann_vol(x1)
    mvol1y = ann_vol(m1)
    return {
        "as_of": end.isoformat(),
        "years_of_history": round((end - stock[0][0]).days / 365.25, 1),
        "volatility": {
            "d30": vol30,
            "y1": vol1y,
            "market_y1": mvol1y,
            "rolling": rolling_vol([x for x in r if x[0] > end - timedelta(days=365 * 5)]),
        },
        "market_rolling": rolling_vol([x for x in rm if x[0] > end - timedelta(days=365 * 5)]),
        "beta": {"y1": b1, "y3": b3, "corr_y1": c1, "corr_y3": c3, "sector_y1": bs1, "sector_corr_y1": cs1},
        "returns": {
            "y1": stock[-1][1] / p1[0][1] - 1 if p1 else None,
            "market_y1": (market[-1][1] / next(p for d, p in market if d > end - timedelta(days=365)) - 1)
            if market
            else None,
        },
        "sharpe": {"y1": s1, "y3": s3, "market_y1": sm1},
        "sortino": {"y1": so1, "y3": so3},
        "var95": var,
        "cvar95": cvar,
        "skew": skew,
        "excess_kurtosis": kurt,
        "drawdown": {
            "current": stock[-1][1] / hi52 - 1,
            "y1": {"max": mdd1, "peak": pk1 and pk1.isoformat(), "trough": tr1 and tr1.isoformat()},
            "y5": {"max": mdd5, "peak": pk5 and pk5.isoformat(), "trough": tr5 and tr5.isoformat()},
            "all": {"max": mddall, "peak": pka and pka.isoformat(), "trough": tra and tra.isoformat()},
            "series": drawdown_series(p5),
        },
        "capture": {"up": upc, "down": dnc},
        "up_days_pct": sum(1 for x in x1 if x > 0) / len(x1) if x1 else None,
        "best_days": [[d.isoformat(), x] for d, x in best],
        "worst_days": [[d.isoformat(), x] for d, x in worst],
        "histogram": histogram(x1),
        "seasonality": seasonality(monthly(stock)),
        "earnings_moves": em[:12],
        "avg_earnings_move": statistics.mean(recent_em) if recent_em else None,
        "fundamental": fundamental_risk(fy),
    }


FY_KEYS = (
    "total_assets", "net_income", "operating_cash_flow", "total_debt", "current_ratio", "diluted_shares",
    "gross_margin", "revenue", "operating_income", "interest_expense", "net_debt_to_ebitda", "sbc",
)  # fmt: skip


def run_company(db: Db, company: dict[str, Any], market: Series) -> dict[str, Any]:
    stock = _series(db, company["ticker"])
    sector = _series(db, company["sector_etf"]) if company.get("sector_etf") else None
    events = db.select(
        "earnings_events", {"cik": f"eq.{company['cik']}", "select": "*", "order": "report_date.desc", "limit": "16"}
    )
    rows = db.select(
        "metric_values",
        {
            "cik": f"eq.{company['cik']}",
            "fiscal_period": "eq.FY",
            "metric": f"in.({','.join(FY_KEYS)})",
            "select": "metric,fiscal_year,value",
            "order": "fiscal_year",
        },
    )
    fy: dict[str, dict[int, float]] = {}
    for x in rows:
        fy.setdefault(x["metric"], {})[int(x["fiscal_year"])] = float(x["value"])
    res = compute(stock, market, sector, events, fy)
    if "error" not in res:
        db.upsert("risk_stats", [{"cik": company["cik"], "as_of": res["as_of"], "result": res}], on_conflict="cik")
    return res


def run_all(
    settings: Any, tickers: list[str] | None = None, missing_only: bool = False, stale_only: bool = False
) -> dict[str, Any]:
    """missing_only: companies with no stats yet. stale_only: also companies whose stats are older than the
    latest SPY price day (the daily run refreshes these; it no longer waits for its own "new trading day")."""
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    have: set[Any] = set()
    if missing_only or stale_only:
        rows = db.select_all("risk_stats", {"select": "cik,as_of"})
        if stale_only:
            last = db.select("prices", {"ticker": "eq.SPY", "select": "date", "order": "date.desc", "limit": "1"})
            latest = last[0]["date"] if last else ""
            have = {r["cik"] for r in rows if str(r.get("as_of") or "") >= latest}
        else:
            have = {r["cik"] for r in rows}
    etfs = {r["sector_etf"] for r in db.select("companies", {"select": "sector_etf"}) if r.get("sector_etf")} | {"SPY"}
    market = _series(db, "SPY")
    out: dict[str, Any] = {}
    for c in db.select("companies", {"select": "cik,ticker,sector_etf"}):
        if c["ticker"] in etfs or (tickers and c["ticker"] not in tickers) or c["cik"] in have:
            continue
        try:
            res = run_company(db, c, market)
            out[c["ticker"]] = res.get("error") or {
                "vol": res["volatility"]["y1"],
                "beta": res["beta"]["y1"],
                "f": (res["fundamental"]["piotroski"] or {}).get("score"),
            }
        except Exception as e:
            out[c["ticker"]] = f"error: {type(e).__name__}: {e}"[:160]
    return out
