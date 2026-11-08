"""Phase 4: peer selection, peer metrics, ranks, and the "how it stacks up" summary.

Peers = companies the 10-K names as competitors (matched to listed tickers) + companies with the same
SEC industry code (SIC), ranked by closeness in revenue. Every metric and rank is computed in code;
the summary is written by Haiku from those computed facts and checked like the brief.
"""

from __future__ import annotations

import logging
import math
import re
import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from ei.ai import AiClient, load_prompt
from ei.db import Db
from ei.filings.brief import verify_claims
from ei.filings.release import numbered
from ei.http import get_with_retries
from ei.sec import SEC_LIMITER, SecClient
from ei.verify import locate

log = logging.getLogger(__name__)
VERSION = "peers-v1"
DEFAULT_N = 5
MIN_N, MAX_N = 3, 7
REVENUE_TAGS = (
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "InterestAndDividendIncomeOperating",
)

# ---------------------------------------------------------------- discovery (SEC)


def sic_ciks(sec: SecClient, sic: str, max_pages: int = 40) -> list[int]:
    """All CIKs EDGAR lists under one SIC code (includes inactive filers; filtered later)."""
    out: list[int] = []
    for page in range(max_pages):
        r = get_with_retries(
            sec._client,
            "https://www.sec.gov/cgi-bin/browse-edgar",
            limiter=SEC_LIMITER,
            params={
                "action": "getcompany",
                "SIC": sic,
                "owner": "include",
                "count": "100",
                "output": "atom",
                "start": str(page * 100),
            },
        )
        found = [int(c) for c in re.findall(r"<cik>(\d+)</cik>", r.text)]
        out.extend(found)
        if len(found) < 100:
            break
    return list(dict.fromkeys(out))


def revenue_frame(sec: SecClient, today: date) -> dict[int, float]:
    """Latest full calendar-year revenue for every XBRL filer (largest value across revenue tags)."""
    out: dict[int, float] = {}
    for year in (today.year - 1, today.year - 2):
        for tag in REVENUE_TAGS:
            try:
                r = get_with_retries(
                    sec._client,
                    f"https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/CY{year}.json",
                    limiter=SEC_LIMITER,
                )
            except Exception:  # a tag with no frame for that year
                continue
            if r.status_code != 200:
                continue
            for row in r.json().get("data", []):
                cik, val = int(row["cik"]), float(row["val"])
                if cik not in out or val > out[cik]:
                    out[cik] = val
        if len(out) > 1500:
            break
    return out


def listed_map(db: Db) -> dict[int, tuple[str, str]]:
    """CIK -> (preferred ticker, name) for US-listed companies."""
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        part = db.select(
            "tickers", {"select": "ticker,cik,name", "order": "cik,ticker", "limit": "1000", "offset": str(offset)}
        )
        rows.extend(part)
        if len(part) < 1000:
            break
        offset += 1000
    best: dict[int, tuple[str, str]] = {}
    for r in rows:
        t, cik = r["ticker"], int(r["cik"])
        cur = best.get(cik)
        key = ("-" in t or "." in t, len(t), t)
        if cur is None or key < ("-" in cur[0] or "." in cur[0], len(cur[0]), cur[0]):
            best[cik] = (t, r["name"])
    return best


# ---------------------------------------------------------------- competitors named in the 10-K

COMP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["competitors"],
    "properties": {
        "competitors": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "ticker_guess", "quote", "para"],
                "properties": {
                    "name": {"type": "string"},
                    "ticker_guess": {"type": ["string", "null"]},
                    "quote": {"type": "string"},
                    "para": {"type": "integer"},
                },
            },
        }
    },
}
_COMPETE = re.compile(r"\bcompet", re.I)


def competition_paragraphs(paras: list[str]) -> list[str]:
    return [p for p in paras if _COMPETE.search(p)][:30]


def verify_competitors(
    raw: dict[str, Any], paras: list[str], listed_by_ticker: dict[str, tuple[int, str]]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for c in raw.get("competitors", []):
        idx = locate(c["quote"], paras, c.get("para"))
        if idx is None or c["name"].lower() not in paras[idx].lower():
            continue
        t = (c.get("ticker_guess") or "").upper().strip()
        hit = listed_by_ticker.get(t)
        if not hit or hit[0] in seen:
            continue
        seen.add(hit[0])
        out.append({"name": c["name"], "ticker": t, "cik": hit[0], "listed_name": hit[1], "quote": c["quote"]})
    return out


def extract_competitors(
    ai: AiClient, paras: list[str], company: str, cik: int, listed_by_ticker: dict[str, tuple[int, str]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not paras:
        return [], {}
    res = ai.json_call(
        model="claude-haiku-5-5",
        purpose="competitors",
        system=load_prompt("competitors.v1.md"),
        user=f"Company: {company}\n\n{numbered(paras)}",
        schema=COMP_SCHEMA,
        max_tokens=3000,
        cik=cik,
        effort="low",
    )
    return verify_competitors(res.data, paras, listed_by_ticker), res.data


# ---------------------------------------------------------------- choosing


def choose_peers(
    target_cik: int,
    target_rev: float | None,
    same_sic: list[int],
    listed: dict[int, tuple[str, str]],
    revenues: dict[int, float],
    competitors: list[dict[str, Any]],
    n: int = DEFAULT_N,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Named competitors of comparable scale first, then same-industry companies closest in revenue.
    Returns (peers, next-best candidates)."""

    def dist(cik: int) -> float:
        r = revenues.get(cik)
        if not target_rev or not r or r <= 0:
            return 99.0
        return abs(math.log(r / target_rev))

    picked: list[dict[str, Any]] = []
    used = {target_cik}
    for c in competitors:
        if c["cik"] in used or c["cik"] not in listed:
            continue
        if dist(c["cik"]) > math.log(20):  # skip names 20x bigger/smaller than the company
            continue
        used.add(c["cik"])
        t, name = listed[c["cik"]]
        picked.append(
            {
                "cik": c["cik"],
                "ticker": t,
                "name": name,
                "source": "10-K competitor",
                "reason": f"Named in the 10-K as “{c['name']}”",
                "quote": c["quote"],
            }
        )
    pool = sorted((cik for cik in same_sic if cik in listed and cik not in used and cik in revenues), key=dist)
    ranked = [
        {
            "cik": cik,
            "ticker": listed[cik][0],
            "name": listed[cik][1],
            "source": "same industry",
            "reason": "Same SEC industry code, similar revenue",
        }
        for cik in pool
    ]
    room = max(n - 2, 1)  # keep room for 2 same-industry peers when the 10-K names many competitors
    peers = (picked[:room] + ranked)[:n]
    if len(peers) < n:  # not enough industry peers: use the remaining named competitors
        peers += [p for p in picked[room:] if p["cik"] not in {q["cik"] for q in peers}][: n - len(peers)]
    rest = [p for p in picked + ranked if p["cik"] not in {q["cik"] for q in peers}][:12]
    return peers, rest


# ---------------------------------------------------------------- metrics


@dataclass(frozen=True)
class Col:
    key: str
    label: str
    fmt: str  # money | x | pct | pct_pts | ratio
    group: str


GENERAL_COLS = [
    Col("market_cap", "Market cap", "money", "size"),
    Col("rev_growth", "Revenue growth (TTM)", "pct", "growth"),
    Col("eps_growth", "EPS growth (TTM)", "pct", "growth"),
    Col("gross_margin", "Gross margin", "pct", "profitability"),
    Col("op_margin", "Operating margin", "pct", "profitability"),
    Col("fcf_margin", "FCF margin", "pct", "profitability"),
    Col("roic", "ROIC", "pct", "profitability"),
    Col("net_debt_ebitda", "Net debt / EBITDA", "x", "balance_sheet"),
    Col("pe", "P/E (GAAP)", "x", "valuation"),
    Col("pe_adj_ltm", "P/E (Street, LTM)", "x", "valuation"),
    Col("pe_fwd_ntm", "Forward P/E", "x", "valuation"),
    Col("ev_ebitda", "EV / EBITDA", "x", "valuation"),
    Col("ev_revenue", "EV / Sales", "x", "valuation"),
    Col("fcf_yield", "FCF yield", "pct", "valuation"),
    Col("beat_rate", "EPS beat rate (8Q)", "pct", "street"),
    Col("avg_surprise", "Avg. EPS surprise (8Q)", "pct", "street"),
    Col("ret_1y", "1-year return", "pct", "street"),
]
BANK_COLS = [
    Col("market_cap", "Market cap", "money", "size"),
    Col("rev_growth", "Revenue growth (TTM)", "pct", "growth"),
    Col("eps_growth", "EPS growth (TTM)", "pct", "growth"),
    Col("roe", "ROE", "pct", "profitability"),
    Col("roa", "ROA", "pct", "profitability"),
    Col("pe", "P/E (GAAP)", "x", "valuation"),
    Col("pe_fwd_ntm", "Forward P/E", "x", "valuation"),
    Col("p_tbv", "Price / tangible book", "x", "valuation"),
    Col("beat_rate", "EPS beat rate (8Q)", "pct", "street"),
    Col("avg_surprise", "Avg. EPS surprise (8Q)", "pct", "street"),
    Col("ret_1y", "1-year return", "pct", "street"),
]


def fmt(v: float | None, kind: str) -> str:
    if v is None:
        return "n/a"
    if kind == "money":
        a = abs(v)
        return f"${a / 1e12:.2f}T" if a >= 1e12 else f"${a / 1e9:.1f}B" if a >= 1e9 else f"${a / 1e6:.0f}M"
    if kind == "x":
        return f"{v:.1f}x"
    if kind == "pct":
        return f"{v * 100:.1f}%"
    return f"{v:.2f}"


def _latest(rows: list[dict[str, Any]], metric: str) -> dict[str, Any] | None:
    r = [x for x in rows if x["metric"] == metric]
    return max(r, key=lambda x: str(x["period_end"])) if r else None


def _year_ago(rows: list[dict[str, Any]], metric: str, end: str) -> dict[str, Any] | None:
    target = date.fromisoformat(end[:10]) - timedelta(days=365)
    cands = [
        x
        for x in rows
        if x["metric"] == metric and abs((date.fromisoformat(str(x["period_end"])[:10]) - target).days) <= 20
    ]
    return cands[0] if cands else None


def company_metrics(db: Db, company: dict[str, Any]) -> dict[str, Any]:
    cik = company["cik"]
    v = company.get("valuation") or {}
    rows = db.select(
        "metric_values",
        {
            "cik": f"eq.{cik}",
            "metric": "in.(revenue_ttm,gross_profit_ttm,operating_income_ttm,free_cash_flow_ttm,net_income_ttm,eps_diluted_ttm,roic,roe,roa,net_debt_to_ebitda)",
            "select": "metric,value,period_end,fiscal_year,fiscal_period",
            "order": "period_end.desc",
            "limit": "400",
        },
    )
    out: dict[str, Any] = {
        k: v.get(k)
        for k in ("market_cap", "pe", "pe_adj_ltm", "pe_fwd_ntm", "ev_ebitda", "ev_revenue", "fcf_yield", "p_tbv")
    }
    rev = _latest(rows, "revenue_ttm")
    out["as_of"] = None
    if rev and rev["value"]:
        out["as_of"] = f"FY{rev['fiscal_year']}{rev['fiscal_period']}"
        prior = _year_ago(rows, "revenue_ttm", str(rev["period_end"]))
        out["rev_growth"] = (
            rev["value"] / prior["value"] - 1 if prior and prior["value"] and prior["value"] > 0 else None
        )
        for key, m in (
            ("gross_margin", "gross_profit_ttm"),
            ("op_margin", "operating_income_ttm"),
            ("fcf_margin", "free_cash_flow_ttm"),
        ):
            x = _latest(rows, m)
            out[key] = x["value"] / rev["value"] if x and x["period_end"] == rev["period_end"] else None
    eps = _latest(rows, "eps_diluted_ttm")
    if eps:
        prior = _year_ago(rows, "eps_diluted_ttm", str(eps["period_end"]))
        out["eps_growth"] = (
            eps["value"] / prior["value"] - 1 if prior and prior["value"] and prior["value"] > 0 else None
        )
    for m, key in (("roic", "roic"), ("roe", "roe"), ("roa", "roa"), ("net_debt_to_ebitda", "net_debt_ebitda")):
        x = _latest(rows, m)
        out[key] = x["value"] if x else None
    ev = db.select(
        "earnings_events",
        {
            "cik": f"eq.{cik}",
            "select": "eps_reported,eps_estimated,report_date",
            "order": "report_date.desc",
            "limit": "12",
        },
    )
    ev = [e for e in ev if e["eps_reported"] is not None and e["eps_estimated"]][:8]
    if len(ev) >= 4:
        out["beat_rate"] = sum(1 for e in ev if e["eps_reported"] >= e["eps_estimated"]) / len(ev)
        out["avg_surprise"] = statistics.mean(
            e["eps_reported"] / e["eps_estimated"] - 1 for e in ev if e["eps_estimated"] > 0
        )
    px = db.select(
        "prices",
        {"ticker": f"eq.{company['ticker']}", "select": "date,adj_close", "order": "date.desc", "limit": "270"},
    )
    if len(px) > 240:
        last = px[0]
        target = date.fromisoformat(last["date"]) - timedelta(days=365)
        old = min(px, key=lambda p: abs((date.fromisoformat(p["date"]) - target).days))
        if abs((date.fromisoformat(old["date"]) - target).days) <= 7 and old["adj_close"]:
            out["ret_1y"] = last["adj_close"] / old["adj_close"] - 1
    return out


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def compare(target: dict[str, Any], peers: list[dict[str, Any]], cols: list[Col]) -> dict[str, Any]:
    """Ranks (1 = highest value), peer medians (excluding the company), and summary facts — all code."""
    everyone = [target, *peers]
    ranks: dict[str, dict[str, int]] = {}
    medians: dict[str, float | None] = {}
    facts: list[dict[str, Any]] = []
    for c in cols:
        vals = [(r["ticker"], r["m"].get(c.key)) for r in everyone if r["m"].get(c.key) is not None]
        order = sorted(vals, key=lambda x: -x[1])
        ranks[c.key] = {t: i + 1 for i, (t, _) in enumerate(order)}
        pv = [r["m"].get(c.key) for r in peers if r["m"].get(c.key) is not None]
        medians[c.key] = statistics.median(pv) if pv else None
        tv = target["m"].get(c.key)
        if tv is None or len(order) < 3 or c.key == "market_cap":
            continue
        rank = ranks[c.key][target["ticker"]]
        hi, lo = order[0], order[-1]
        pos = "highest" if rank == 1 else "lowest" if rank == len(order) else f"{ordinal(rank)} highest"
        text = (
            f"{c.label}: {target['ticker']} {fmt(tv, c.fmt)} — {pos} of {len(order)}; peer median {fmt(medians[c.key], c.fmt)}; "
            f"range {lo[0]} {fmt(lo[1], c.fmt)} to {hi[0]} {fmt(hi[1], c.fmt)}"
        )
        facts.append({"type": "peer", "group": c.group, "metric": c.key, "text": text})
    return {"ranks": ranks, "medians": medians, "facts": {f"P{i + 1}": f for i, f in enumerate(facts)}}


SUMMARY_SCHEMA: dict[str, Any] = {
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
                    "section": {
                        "type": "string",
                        "enum": ["valuation", "growth", "profitability", "balance_sheet", "street"],
                    },
                    "text": {"type": "string"},
                    "refs": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}


def summarize(
    ai: AiClient, facts: dict[str, dict[str, Any]], company: str, peers: list[str], cik: int
) -> dict[str, Any]:
    body = "\n".join(f"[{k}] {v['text']}" for k, v in facts.items())
    res = ai.json_call(
        model="claude-haiku-5-5",
        purpose="peers-summary",
        system=load_prompt("peers_summary.v1.md"),
        user=f"Company: {company}\nPeers: {', '.join(peers)}\n\nFACTS\n{body}",
        schema=SUMMARY_SCHEMA,
        max_tokens=2000,
        cik=cik,
        effort="medium",
    )
    kept, dropped = verify_claims(res.data, facts)
    return {"claims": kept, "dropped": dropped, "cost_usd": float(res.cost)}


# ---------------------------------------------------------------- job


def _today() -> date:
    return date.today()


def _now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def run_peers(
    settings: Any, ticker: str, job_id: int | None = None, override: list[str] | None = None, n: int | None = None
) -> dict[str, Any]:
    """Pick (or apply edited) peers, load them (financials + prices + Street data, no AI), compare, summarize."""
    from ei.filings.run import ANNUAL, Fetcher
    from ei.jobs import Job, analyze

    db = Db(settings.supabase_url, settings.supabase_secret_key)
    job = Job(db, "peers", ticker.upper(), job_id)
    ai = AiClient(settings.anthropic_api_key, db) if settings.anthropic_api_key else None
    fetch = Fetcher(settings, db)
    try:
        comp = db.select("companies", {"ticker": f"eq.{ticker.upper()}", "select": "*"})
        if not comp:
            raise RuntimeError("Load the company first")
        company = comp[0]
        cik = company["cik"]
        cols = BANK_COLS if company.get("sector_pack") == "bank" else GENERAL_COLS
        existing = db.select("peer_sets", {"cik": f"eq.{cik}", "select": "*"})
        listed = listed_map(db)
        by_ticker = {t: (c, nm) for c, (t, nm) in listed.items()}
        # all tickers (incl. share classes) resolve to a company
        job.step("select", "running", "Choosing peers")
        if override is not None:
            peers: list[dict[str, Any]] = []
            for t in override:
                t = t.upper().strip()
                hit = by_ticker.get(t)
                if hit is None:
                    rows = db.select("tickers", {"ticker": f"eq.{t}", "select": "cik,name"})
                    hit = (int(rows[0]["cik"]), rows[0]["name"]) if rows else None
                if hit and hit[0] != cik and hit[0] not in {p["cik"] for p in peers}:
                    prev = next((p for p in (existing[0]["peers"] if existing else []) if p["cik"] == hit[0]), None)
                    peers.append(
                        prev
                        or {
                            "cik": hit[0],
                            "ticker": listed.get(hit[0], (t, ""))[0],
                            "name": hit[1],
                            "source": "added by you",
                            "reason": "Added by you",
                        }
                    )
            peers = peers[:MAX_N]
            candidates = existing[0].get("candidates") if existing else []
            db.upsert(
                "peer_sets",
                [{"cik": cik, "peers": peers, "candidates": candidates, "edited": True, "updated_at": _now()}],
                on_conflict="cik",
            )
            job.step("select", "done", "Your peer list: " + ", ".join(p["ticker"] for p in peers))
        elif existing and (existing[0]["edited"] or n is None):
            peers = existing[0]["peers"]
            job.step(
                "select",
                "done",
                ("Your peer list: " if existing[0]["edited"] else "Peers: ") + ", ".join(p["ticker"] for p in peers),
            )
        else:
            competitors: list[dict[str, Any]] = []
            annual = db.select(
                "filings",
                {
                    "cik": f"eq.{cik}",
                    "form": f"in.({','.join(ANNUAL)})",
                    "select": "*",
                    "order": "filed_date.desc",
                    "limit": "1",
                },
            )
            if annual and ai is not None:
                acc = annual[0]["accession"]
                cached = db.select(
                    "filing_analysis",
                    {
                        "accession": f"eq.{acc}",
                        "kind": "eq.competitors",
                        "version": f"eq.{VERSION}",
                        "select": "result",
                    },
                )
                if cached:
                    competitors = cached[0]["result"]["competitors"]
                else:
                    secs = fetch.sections(annual[0], cik)
                    paras = competition_paragraphs((secs.get("business") or {}).get("paragraphs") or [])
                    competitors, raw = extract_competitors(ai, paras, company["name"], cik, by_ticker)
                    db.upsert(
                        "filing_analysis",
                        [
                            {
                                "accession": acc,
                                "cik": cik,
                                "kind": "competitors",
                                "version": VERSION,
                                "result": {"competitors": competitors},
                                "raw": raw,
                            }
                        ],
                        on_conflict="accession,kind,version",
                    )
            same = sic_ciks(fetch.sec, company["sic"]) if company.get("sic") else []
            revenues = revenue_frame(fetch.sec, _today())
            peers, candidates = choose_peers(
                cik, revenues.get(cik), same, listed, revenues, competitors, n or DEFAULT_N
            )
            db.upsert(
                "peer_sets",
                [{"cik": cik, "peers": peers, "candidates": candidates, "edited": False, "updated_at": _now()}],
                on_conflict="cik",
            )
            job.step(
                "select",
                "done",
                f"{len(competitors)} competitors named in the 10-K · {sum(1 for c in same if c in listed)} listed companies in SIC {company.get('sic')} · picked "
                + ", ".join(p["ticker"] for p in peers),
            )

        job.step("load", "running", "Loading peer financials, prices and Street estimates (no AI)")
        loaded, deferred = [], []
        for p in peers:
            row = db.select("companies", {"cik": f"eq.{p['cik']}", "select": "last_ingested_at"})
            fresh = (
                row
                and row[0]["last_ingested_at"]
                and str(row[0]["last_ingested_at"])[:10] >= str(_today() - timedelta(days=3))
            )
            if not fresh:
                try:
                    r = analyze(settings, p["ticker"], primary=False)
                    if not r.get("ok", True):
                        deferred.append(p["ticker"])
                except Exception as e:
                    log.warning("peer load failed for %s: %s", p["ticker"], e)
                    deferred.append(p["ticker"])
            loaded.append(p["ticker"])
        job.step(
            "load",
            "done",
            f"{len(loaded)} peers ready"
            + (f" · {', '.join(deferred)} incomplete (free-tier limit; retried automatically)" if deferred else ""),
        )

        job.step("compare", "running", "Ranking on Street metrics")
        company = db.select("companies", {"cik": f"eq.{cik}", "select": "*"})[0]
        target = {"cik": cik, "ticker": company["ticker"], "name": company["name"], "m": company_metrics(db, company)}
        prow = []
        for p in peers:
            c = db.select("companies", {"cik": f"eq.{p['cik']}", "select": "*"})
            if c:
                prow.append(
                    {"cik": p["cik"], "ticker": c[0]["ticker"], "name": c[0]["name"], "m": company_metrics(db, c[0])}
                )
        result = compare(target, prow, cols)
        result["columns"] = [c.__dict__ for c in cols]
        result["rows"] = [target, *prow]
        job.step("compare", "done", f"{len(cols)} metrics across {len(prow) + 1} companies")

        job.step("summary", "running", "Writing the stacks-up summary (Haiku)")
        prev = db.select("peer_comparisons", {"cik": f"eq.{cik}", "select": "result,claims,dropped,version"})
        if prev and prev[0]["version"] == VERSION and prev[0]["result"].get("facts") == result["facts"]:
            summ = {"claims": prev[0]["claims"], "dropped": prev[0]["dropped"], "cost_usd": 0.0}
            job.step("summary", "done", "Unchanged — kept existing summary (no cost)")
        elif ai is not None and len(result["facts"]) >= 3:
            summ = summarize(ai, result["facts"], company["name"], [p["ticker"] for p in prow], cik)
            job.step(
                "summary",
                "done",
                f"{len(summ['claims'])} verified sentences · {len(summ['dropped'])} dropped · ${summ['cost_usd']:.4f}",
            )
        else:
            summ = {"claims": [], "dropped": [], "cost_usd": 0.0}
            job.step("summary", "done", "Not enough comparable data for a summary")
        db.upsert(
            "peer_comparisons",
            [
                {
                    "cik": cik,
                    "version": VERSION,
                    "peer_ciks": [p["cik"] for p in prow],
                    "result": result,
                    "claims": summ["claims"],
                    "dropped": summ["dropped"],
                    "cost_usd": summ["cost_usd"],
                    "created_at": _now(),
                }
            ],
            on_conflict="cik",
        )
        job.finish("done", None, cik)
        return {"ok": True, "peers": [p["ticker"] for p in prow]}
    except Exception as e:
        job.finish("failed", f"{type(e).__name__}: {str(e)[:400]}")
        raise
    finally:
        fetch.close()
