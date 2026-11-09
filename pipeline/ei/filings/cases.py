"""Bull / base / bear cases per stock.

Scenario values are computed here: next-12-months EPS (analysts' low / consensus / high, from
Alpha Vantage) × the stock's own forward P/E range over the past 3 years (20th percentile / median /
80th percentile of monthly readings, each = price ÷ the consensus for the following four quarters). Sonnet then writes what each case requires, citing only verified
facts; code checks every citation and number.
"""

from __future__ import annotations

import bisect
import statistics
from datetime import date
from typing import Any

from ei.ai import AiClient, load_prompt
from ei.db import Db
from ei.filings.brief import verify_claims
from ei.street import ntm_eps

VERSION = "cases-v2"
MODEL = "claude-sonnet-5-5"
YEARS = 3
SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["claims"],
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["section", "text", "refs"],
                "properties": {
                    "section": {"type": "string", "enum": ["bear", "base", "bull", "watch"]},
                    "text": {"type": "string"},
                    "refs": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}


def percentile(xs: list[float], q: float) -> float:
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def split_adjusted_closes(rows: list[dict[str, Any]]) -> tuple[list[date], list[float]]:
    """Closes on today's share basis (splits only, no dividend adjustment), oldest first."""
    rows = sorted(rows, key=lambda r: r["date"])
    out_d, out_p = [], []
    factor = 1.0
    adj: list[float] = [0.0] * len(rows)
    for i in range(len(rows) - 1, -1, -1):
        adj[i] = float(rows[i]["close"]) / factor
        sf = float(rows[i].get("split_factor") or 1.0)
        if sf and sf != 1.0:
            factor *= sf  # earlier prices are on the pre-split share count
    for r, p in zip(rows, adj, strict=True):
        out_d.append(date.fromisoformat(r["date"]))
        out_p.append(p)
    return out_d, out_p


def forward_pe_series(
    quarter_eps: dict[date, float], prices: tuple[list[date], list[float]], today: date
) -> list[tuple[date, float]]:
    """Monthly forward P/E over the past YEARS: price at each month-end ÷ the consensus EPS for the
    next four quarters as it stood then (each quarter's pre-report consensus, from Street data)."""
    pd_, pp = prices
    ends = sorted(quarter_eps)
    out: list[tuple[date, float]] = []
    d = date(today.year - YEARS, today.month, 1)
    while d <= today:
        i = bisect.bisect_right(pd_, d) - 1
        k = bisect.bisect_right(ends, d)
        nxt = ends[k : k + 4]
        if i >= 0 and len(nxt) == 4 and (nxt[-1] - d).days < 400:
            ntm = sum(quarter_eps[e] for e in nxt)
            if ntm > 0:
                pe = pp[i] / ntm
                if 0 < pe < 200:
                    out.append((d, pe))
        d = date(d.year + (d.month // 12), d.month % 12 + 1, 1)
    return out


def forward_pe_history(
    quarter_eps: dict[date, float], prices: tuple[list[date], list[float]], today: date
) -> list[float]:
    return [pe for _, pe in forward_pe_series(quarter_eps, prices, today)]


def scenario_numbers(db: Db, company: dict[str, Any], today: date) -> dict[str, Any] | None:
    cik = company["cik"]
    v = company.get("valuation") or {}
    price = v.get("price")
    if not price:
        return None
    est = db.select("eps_estimates", {"cik": f"eq.{cik}", "select": "*"})
    ev = db.select(
        "earnings_events",
        {
            "cik": f"eq.{cik}",
            "eps_reported": "not.is.null",
            "select": "period_end",
            "order": "period_end.desc",
            "limit": "1",
        },
    )
    last_end = date.fromisoformat(str(ev[0]["period_end"])[:10]) if ev else None
    eps: dict[str, float | None] = {}
    for f in ("eps_low", "eps_avg", "eps_high"):
        rows = [{**e, "eps_avg": e[f]} for e in est if e.get(f) is not None]
        eps[f], _ = ntm_eps(rows, last_end, today)
    _, method = ntm_eps(est, last_end, today)
    analysts = max(
        (
            int(e.get("analysts") or 0)
            for e in est
            if e["horizon"] == "fiscal year" and str(e["period_end"]) > str(today)
        ),
        default=0,
    )
    # pre-report consensus for reported quarters + current estimates for upcoming ones
    q_eps: dict[date, float] = {}
    for e in est:
        if e["horizon"] == "fiscal quarter" and e.get("eps_avg") is not None:
            q_eps[date.fromisoformat(str(e["period_end"])[:10])] = float(e["eps_avg"])
    for e in db.select(
        "earnings_events",
        {"cik": f"eq.{cik}", "eps_estimated": "not.is.null", "select": "period_end,eps_estimated", "limit": "400"},
    ):
        q_eps[date.fromisoformat(str(e["period_end"])[:10])] = float(e["eps_estimated"])
    px = db.select(
        "prices",
        {
            "ticker": f"eq.{company['ticker']}",
            "date": f"gte.{date(today.year - YEARS - 1, 1, 1)}",
            "select": "date,close,split_factor",
            "order": "date",
            "limit": "2000",
        },
    )
    series = forward_pe_series(q_eps, split_adjusted_closes(px), today)
    pes = [pe for _, pe in series]
    out: dict[str, Any] = {
        "price": price,
        "price_date": v.get("price_date"),
        "eps": eps,
        "eps_method": method,
        "analysts": analysts,
        "pe_samples": len(pes),
        "pe_series": [[d.isoformat(), round(pe, 2)] for d, pe in series],
    }
    if len(pes) < 18 or not eps.get("eps_avg"):
        out["scenarios"] = None
        return out
    pct = {"p20": percentile(pes, 0.2), "p50": statistics.median(pes), "p80": percentile(pes, 0.8)}
    out["pe"] = pct
    sc: dict[str, dict[str, Any] | None] = {}
    for case, ek, pk in (("bear", "eps_low", "p20"), ("base", "eps_avg", "p50"), ("bull", "eps_high", "p80")):
        case_eps = eps.get(ek)
        if case_eps is None or case_eps <= 0:
            sc[case] = None
            continue
        val = case_eps * pct[pk]
        sc[case] = {"eps": case_eps, "pe": pct[pk], "value": val, "vs_price": val / price - 1}
    out["scenarios"] = sc
    return out


def value_facts(n: dict[str, Any], ticker: str) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = [
        {"type": "price", "text": f"{ticker} share price ${n['price']:.2f} (as of {n.get('price_date')})"}
    ]
    e = n["eps"]
    if e.get("eps_avg"):
        rng = (
            f"low ${e['eps_low']:.2f}, consensus ${e['eps_avg']:.2f}, high ${e['eps_high']:.2f}"
            if e.get("eps_low") and e.get("eps_high")
            else f"consensus ${e['eps_avg']:.2f}"
        )
        facts.append(
            {
                "type": "eps_range",
                "text": f"Next-12-months EPS estimates: {rng}"
                + (f" ({n['analysts']} analysts)" if n.get("analysts") else "")
                + " (Alpha Vantage)",
            }
        )
    if n.get("pe"):
        p = n["pe"]
        facts.append(
            {
                "type": "pe_range",
                "text": f"{ticker} forward P/E (price ÷ next-12-months consensus EPS) over the past {YEARS} years: 20th percentile {p['p20']:.1f}x, median {p['p50']:.1f}x, 80th percentile {p['p80']:.1f}x ({n['pe_samples']} monthly readings)",
            }
        )
    words = {
        "bear": ("Bear", "low EPS", "20th-percentile P/E"),
        "base": ("Base", "consensus EPS", "median P/E"),
        "bull": ("Bull", "high EPS", "80th-percentile P/E"),
    }
    for case, s in (n.get("scenarios") or {}).items():
        if not s:
            continue
        name, el, pl = words[case]
        sign = "+" if s["vs_price"] >= 0 else "−"
        facts.append(
            {
                "type": f"scenario_{case}",
                "case": case,
                "text": f"{name} scenario value: {el} ${s['eps']:.2f} × {pl} {s['pe']:.1f}x = ${s['value']:.2f} ({sign}{abs(s['vs_price']) * 100:.1f}% vs. today's price)",
            }
        )
    return facts


def build_facts(
    db: Db, company: dict[str, Any], numbers: dict[str, Any]
) -> tuple[dict[str, dict[str, Any]], str | None, str | None]:
    facts: dict[str, dict[str, Any]] = {f"V{i + 1}": f for i, f in enumerate(value_facts(numbers, company["ticker"]))}
    brief = db.select(
        "briefs",
        {
            "cik": f"eq.{company['cik']}",
            "select": "period_a,period_b,inputs",
            "order": "period_b.desc,created_at.desc",
            "limit": "1",
        },
    )
    pa = pb = None
    if brief:
        pa, pb = brief[0]["period_a"], brief[0]["period_b"]
        for k, f in brief[0]["inputs"]["facts"].items():
            facts[k] = f
    peers = db.select("peer_comparisons", {"cik": f"eq.{company['cik']}", "select": "result"})
    if peers:
        for k, f in (peers[0]["result"].get("facts") or {}).items():
            facts[k] = f  # P1, P2, ... (peer comparison)
    return facts, pa, pb


def write_cases(ai: AiClient, facts: dict[str, dict[str, Any]], company: str, cik: int) -> dict[str, Any]:
    body = "\n".join(f"[{k}] {v['text']}" for k, v in facts.items())
    res = ai.json_call(
        model=MODEL,
        purpose="cases",
        system=load_prompt("cases.v2.md"),
        user=f"Company: {company}\n\nFACTS\n{body}",
        schema=SCHEMA,
        max_tokens=4000,
        cik=cik,
        effort="medium",
    )
    kept, dropped = verify_claims(res.data, facts)
    # each case's first sentence must cite that case's scenario value when one exists
    for case in ("bear", "base", "bull"):
        vid = next((k for k, f in facts.items() if f.get("case") == case), None)
        first = next((c for c in kept if c["section"] == case), None)
        if vid and first and vid not in first["refs"]:
            first["refs"] = [vid, *first["refs"]]
    return {"claims": kept, "dropped": dropped, "cost_usd": float(res.cost)}


def run_cases(settings: Any, ticker: str, job: Any | None = None) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    comp = db.select("companies", {"ticker": f"eq.{ticker.upper()}", "select": "*"})
    if not comp:
        return {"ok": False, "reason": "company not loaded"}
    company = comp[0]
    numbers = scenario_numbers(db, company, date.today())
    if numbers is None:
        return {"ok": False, "reason": "no price yet"}
    facts, pa, pb = build_facts(db, company, numbers)
    prev = db.select("stock_cases", {"cik": f"eq.{company['cik']}", "select": "facts,version"})
    if prev and prev[0]["version"] == VERSION and prev[0]["facts"] == facts:
        db.update("stock_cases", {"cik": company["cik"]}, {"numbers": numbers})  # refresh chart data, no AI
        return {"ok": True, "cached": True}
    if not settings.anthropic_api_key:
        return {"ok": False, "reason": "no AI key"}
    out = write_cases(AiClient(settings.anthropic_api_key, db), facts, company["name"], company["cik"])
    db.upsert(
        "stock_cases",
        [
            {
                "cik": company["cik"],
                "version": VERSION,
                "period_a": pa,
                "period_b": pb,
                "numbers": numbers,
                "facts": facts,
                "claims": out["claims"],
                "dropped": out["dropped"],
                "cost_usd": out["cost_usd"],
                "created_at": date.today().isoformat(),
            }
        ],
        on_conflict="cik",
    )
    return {"ok": True, "claims": len(out["claims"]), "dropped": len(out["dropped"]), "cost_usd": out["cost_usd"]}
