"""Options snapshot per stock from Cboe's free delayed quotes (15-minute delayed; no key; no AI).

From the full option chain we compute, in code:
  - expected move by expiry (at-the-money straddle price / stock price) and ATM implied volatility
  - the move options price for the next earnings report
  - implied vs realized volatility, IV rank (once a year of daily history builds up)
  - skew (25-delta put IV − 25-delta call IV), put/call ratios, max pain, busiest strikes and contracts
"""

from __future__ import annotations

import logging
import re
import statistics
from datetime import date, datetime
from typing import Any

import httpx

from ei.db import Db
from ei.http import RateLimiter, get_with_retries

log = logging.getLogger(__name__)

URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json"
LIMITER = RateLimiter(rate=2)
SYM = re.compile(r"^(?P<root>[A-Z.]+?)(?P<ymd>\d{6})(?P<cp>[CP])(?P<strike>\d{8})$")


def parse_symbol(s: str) -> tuple[date, str, float] | None:
    m = SYM.match(s.strip())
    if not m:
        return None
    ymd = m.group("ymd")
    return datetime.strptime(ymd, "%y%m%d").date(), m.group("cp"), int(m.group("strike")) / 1000


def _num(v: Any) -> float | None:
    try:
        x = float(v)
        return x if x == x else None  # NaN
    except (TypeError, ValueError):
        return None


def _iv(v: Any) -> float | None:
    x = _num(v)
    if x is None or x <= 0:
        return None
    return x / 100 if x > 5 else x  # some feeds give percent


def mid(o: dict[str, Any]) -> float | None:
    b, a = _num(o.get("bid")), _num(o.get("ask"))
    if b is not None and a is not None and a > 0 and a >= b:
        return (a + b) / 2
    last = _num(o.get("last_trade_price"))
    return last if last and last > 0 else None


def contracts(raw: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for o in raw.get("data", {}).get("options", []):
        p = parse_symbol(str(o.get("option", "")))
        if not p:
            continue
        exp, cp, k = p
        out.append(
            {
                "symbol": o["option"],
                "exp": exp,
                "cp": cp,
                "strike": k,
                "mid": mid(o),
                "iv": _iv(o.get("iv")),
                "delta": _num(o.get("delta")),
                "oi": int(_num(o.get("open_interest")) or 0),
                "volume": int(_num(o.get("volume")) or 0),
            }
        )
    return out


def atm(chain: list[dict[str, Any]], spot: float) -> dict[str, Any] | None:
    """Straddle at the strike nearest the stock price that has both a call and a put price."""
    by_k: dict[float, dict[str, dict[str, Any]]] = {}
    for c in chain:
        by_k.setdefault(c["strike"], {})[c["cp"]] = c
    ks = [k for k, v in by_k.items() if v.get("C", {}).get("mid") and v.get("P", {}).get("mid")]
    if not ks:
        return None
    k = min(ks, key=lambda x: abs(x - spot))
    call, put = by_k[k]["C"], by_k[k]["P"]
    ivs = [x for x in (call["iv"], put["iv"]) if x]
    straddle = call["mid"] + put["mid"]
    return {"strike": k, "straddle": straddle, "move": straddle / spot, "iv": statistics.mean(ivs) if ivs else None}


def max_pain(chain: list[dict[str, Any]]) -> float | None:
    """Strike where option holders would collect the least at expiry (total payout is smallest)."""
    strikes = sorted({c["strike"] for c in chain})
    if not strikes or not any(c["oi"] for c in chain):
        return None

    def payout(s: float) -> float:
        return float(
            sum(c["oi"] * (max(0.0, s - c["strike"]) if c["cp"] == "C" else max(0.0, c["strike"] - s)) for c in chain)
        )

    return float(min(strikes, key=payout))


def skew(chain: list[dict[str, Any]]) -> dict[str, Any] | None:
    puts = [c for c in chain if c["cp"] == "P" and c["delta"] is not None and c["iv"]]
    calls = [c for c in chain if c["cp"] == "C" and c["delta"] is not None and c["iv"]]
    if not puts or not calls:
        return None
    p = min(puts, key=lambda c: abs(c["delta"] + 0.25))
    c = min(calls, key=lambda c: abs(c["delta"] - 0.25))
    if abs(p["delta"] + 0.25) > 0.1 or abs(c["delta"] - 0.25) > 0.1:
        return None
    return {
        "put_iv": p["iv"],
        "call_iv": c["iv"],
        "skew": p["iv"] - c["iv"],
        "put_strike": p["strike"],
        "call_strike": c["strike"],
    }


def summarize(
    raw: dict[str, Any], today: date, next_earnings: date | None, realized30: float | None, iv_hist: list[float]
) -> dict[str, Any]:
    data = raw.get("data", {})
    spot = _num(data.get("current_price")) or _num(data.get("close"))
    chain = contracts(raw)
    if not spot or not chain:
        return {"error": "no option chain"}
    exps = sorted({c["exp"] for c in chain if c["exp"] >= today})
    by_exp = {e: [c for c in chain if c["exp"] == e] for e in exps}
    term = []
    for e in exps[:12]:
        a = atm(by_exp[e], spot)
        if a:
            term.append({"exp": e.isoformat(), "dte": (e - today).days, **a})
    # 30-day IV: Cboe's own figure when given, else interpolate the ATM term structure
    iv30 = _iv(data.get("iv30"))
    if iv30 is None and term:
        near = min((t for t in term if t["iv"]), key=lambda t: abs(t["dte"] - 30), default=None)
        iv30 = near["iv"] if near else None
    month = min((e for e in exps if (e - today).days >= 20), key=lambda e: abs((e - today).days - 30), default=exps[0])
    mchain = by_exp[month]
    calls = [c for c in chain if c["cp"] == "C"]
    puts = [c for c in chain if c["cp"] == "P"]
    cv, pv = sum(c["volume"] for c in calls), sum(c["volume"] for c in puts)
    co, po = sum(c["oi"] for c in calls), sum(c["oi"] for c in puts)
    earn = None
    if next_earnings and next_earnings >= today:
        after = [t for t in term if t["exp"] > next_earnings.isoformat()]
        if after:
            t = after[0]
            earn = {
                "date": next_earnings.isoformat(),
                "exp": t["exp"],
                "move": t["move"],
                "straddle": t["straddle"],
                "strike": t["strike"],
            }
    rank = None
    if iv30 is not None and len(iv_hist) >= 60:
        lo, hi = min([*iv_hist, iv30]), max([*iv_hist, iv30])
        rank = (iv30 - lo) / (hi - lo) if hi > lo else None

    def top(rows: list[dict[str, Any]], key: str, n: int) -> list[dict[str, Any]]:
        return [
            {
                "symbol": c["symbol"],
                "exp": c["exp"].isoformat(),
                "cp": c["cp"],
                "strike": c["strike"],
                "volume": c["volume"],
                "oi": c["oi"],
                "iv": c["iv"],
                "mid": c["mid"],
            }
            for c in sorted(rows, key=lambda c: -c[key])[:n]
            if c[key] > 0
        ]

    return {
        "spot": spot,
        "as_of": str(raw.get("timestamp") or today.isoformat()),
        "iv30": iv30,
        "realized30": realized30,
        "iv_rank": rank,
        "iv_history_days": len(iv_hist),
        "term": term,
        "earnings": earn,
        "month_exp": month.isoformat(),
        "skew": skew(mchain),
        "max_pain": max_pain(mchain),
        "put_call_volume": pv / cv if cv else None,
        "put_call_oi": po / co if co else None,
        "volume": {"calls": cv, "puts": pv},
        "open_interest": {"calls": co, "puts": po},
        "top_oi_calls": top([c for c in mchain if c["cp"] == "C"], "oi", 3),
        "top_oi_puts": top([c for c in mchain if c["cp"] == "P"], "oi", 3),
        "most_active": top(chain, "volume", 6),
        "oi_by_strike": sorted(
            [
                [
                    k,
                    sum(c["oi"] for c in mchain if c["strike"] == k and c["cp"] == "C"),
                    sum(c["oi"] for c in mchain if c["strike"] == k and c["cp"] == "P"),
                ]
                for k in {c["strike"] for c in mchain}
                if 0.7 * spot <= k <= 1.3 * spot
            ],
        ),
        "expirations": len(exps),
        "contracts": len(chain),
    }


def run_all(settings: Any, tickers: list[str] | None = None) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    etfs = {r["sector_etf"] for r in db.select("companies", {"select": "sector_etf"}) if r.get("sector_etf")} | {"SPY"}
    client = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "EarningsIntel/1.0 (research)"})
    today = date.today()
    out: dict[str, Any] = {}
    try:
        for c in db.select("companies", {"select": "cik,ticker"}):
            t = c["ticker"]
            if t in etfs or (tickers and t not in tickers):
                continue
            try:
                resp = get_with_retries(client, URL.format(symbol=t.replace("-", ".")), limiter=LIMITER)
                if resp.status_code == 403 or resp.status_code == 404:
                    out[t] = "no options listed"
                    continue
                resp.raise_for_status()
                raw = resp.json()
                cal = db.select("earnings_calendar", {"ticker": f"eq.{t}", "select": "report_date"})
                ne = date.fromisoformat(str(cal[0]["report_date"])[:10]) if cal else None
                risk = db.select("risk_stats", {"cik": f"eq.{c['cik']}", "select": "result"})
                rv30 = ((risk[0]["result"].get("volatility") or {}).get("d30")) if risk else None
                hist = [
                    float(h["iv30"])
                    for h in db.select(
                        "options_iv_history",
                        {
                            "cik": f"eq.{c['cik']}",
                            "date": f"gte.{date(today.year - 1, today.month, min(today.day, 28))}",
                            "select": "iv30",
                        },
                    )
                    if h.get("iv30") is not None
                ]
                res = summarize(raw, today, ne, rv30, hist)
                if "error" in res:
                    out[t] = res["error"]
                    continue
                db.upsert(
                    "options_snapshot",
                    [{"cik": c["cik"], "as_of": today.isoformat(), "result": res}],
                    on_conflict="cik",
                )
                if res["iv30"] is not None:
                    db.upsert(
                        "options_iv_history",
                        [{"cik": c["cik"], "date": today.isoformat(), "iv30": res["iv30"]}],
                        on_conflict="cik,date",
                    )
                out[t] = {
                    "iv30": res["iv30"],
                    "contracts": res["contracts"],
                    "earn_move": (res["earnings"] or {}).get("move"),
                }
            except Exception as e:
                out[t] = f"error: {type(e).__name__}: {e}"[:160]
    finally:
        client.close()
    return out
