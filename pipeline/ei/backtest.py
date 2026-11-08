"""Phase 6: backtest — did the app's signals come before the stock beating or lagging its sector?

For every event (an earnings report or a new 10-K) we record a signal value and the stock's return
minus its sector ETF's return:
  - reaction: the first trading day after the news (same-day information, not a prediction),
  - drift20 / drift60: the 20 / 60 trading days AFTER the reaction day (the actual prediction test).
Events are split into groups by signal value and the difference in average drift is measured, with a
bootstrap 95% range. All math is in this file; no AI is used to compute anything.

Data collection runs inside the free limits and keeps going day by day (transcripts: Alpha Vantage
25/day minus a reserve for your own use; 10-Ks: SEC, free).
"""

from __future__ import annotations

import bisect
import itertools
import logging
import math
import random
import statistics
from dataclasses import dataclass
from datetime import date
from typing import Any

from ei.config import Settings
from ei.db import Db

log = logging.getLogger(__name__)
HISTORY_FROM = 2014  # 10-Ks and transcripts from this fiscal year on
TRANSCRIPT_QUARTERS = 12
USER_RESERVE = 0  # use the whole free transcript allowance (25/day) for history


@dataclass(frozen=True)
class SignalDef:
    key: str
    title: str
    unit: str  # pct | pp | count | ratio
    kind: str  # "continuous" (terciles) or "count" (any vs none)
    high_label: str
    low_label: str
    explain: str


SIGNALS = [
    SignalDef(
        "eps_surprise",
        "Earnings surprise",
        "pct",
        "continuous",
        "Biggest beats",
        "Smallest beats / misses",
        "Street EPS vs. consensus at the report. The classic 'post-earnings drift' test.",
    ),
    SignalDef(
        "rev_accel",
        "Revenue growth speeding up",
        "pp",
        "continuous",
        "Growth accelerating most",
        "Growth slowing most",
        "Year-over-year revenue growth this quarter minus last quarter's (SEC data).",
    ),
    SignalDef(
        "tone_change",
        "Management tone on the call",
        "ratio",
        "continuous",
        "Tone improved most",
        "Tone worsened most",
        "Change in executives' net tone (Loughran-McDonald word lists) vs. the same quarter a year earlier.",
    ),
    SignalDef(
        "hedging_change",
        "Hedging language on the call",
        "pp",
        "continuous",
        "Hedged more",
        "Hedged less",
        "Change in executives' uncertainty words per 100 words vs. a year earlier.",
    ),
    SignalDef(
        "risk_escalated",
        "Stronger risk-factor wording",
        "count",
        "count",
        "10-Ks with stronger wording",
        "10-Ks without",
        "Risk factors reworded from 'may' to 'has' or newly saying a risk has materialized (10-K vs. prior 10-K).",
    ),
    SignalDef(
        "risk_added",
        "New risk factors",
        "count",
        "count",
        "10-Ks adding risks",
        "10-Ks adding none",
        "Risk factors present this year with no match last year.",
    ),
    SignalDef(
        "guidance_net",
        "Guidance raised vs. cut",
        "count",
        "continuous",
        "Net raised",
        "Net cut",
        "Guidance items raised minus items cut or withdrawn on the call (AI-extracted, verified quotes).",
    ),
]
BY_KEY = {s.key: s for s in SIGNALS}

# ---------------------------------------------------------------- returns


class Prices:
    """Adjusted closes per ticker with trading-day arithmetic."""

    def __init__(self, db: Db) -> None:
        self.db = db
        self.cache: dict[str, tuple[list[date], list[float]]] = {}

    def series(self, ticker: str) -> tuple[list[date], list[float]]:
        if ticker not in self.cache:
            rows: list[dict[str, Any]] = []
            offset = 0
            while True:
                part = self.db.select(
                    "prices",
                    {
                        "ticker": f"eq.{ticker}",
                        "select": "date,adj_close",
                        "order": "date",
                        "limit": "1000",
                        "offset": str(offset),
                    },
                )
                rows += part
                if len(part) < 1000:
                    break
                offset += 1000
            pts = [(date.fromisoformat(r["date"]), float(r["adj_close"])) for r in rows if r["adj_close"]]
            self.cache[ticker] = ([d for d, _ in pts], [p for _, p in pts])
        return self.cache[ticker]


def event_returns(
    stock: tuple[list[date], list[float]], bench: tuple[list[date], list[float]], when: date, before_open: bool
) -> dict[str, float | None]:
    """Abnormal returns (stock minus benchmark) around an event. If the news came after the close (or
    the time is unknown), the reaction day is the next trading day."""
    sd, sp = stock
    bd, bp = bench
    if not sd or not bd:
        return {"reaction": None, "drift20": None, "drift60": None}
    i = bisect.bisect_left(sd, when) if before_open else bisect.bisect_right(sd, when)
    if i <= 0 or i >= len(sd):
        return {"reaction": None, "drift20": None, "drift60": None}
    bmap = dict(zip(bd, bp, strict=True))

    def ret(a: int, b: int) -> float | None:
        if b >= len(sd) or a < 0:
            return None
        da, db_ = sd[a], sd[b]
        if da not in bmap or db_ not in bmap:
            return None
        return (sp[b] / sp[a] - 1) - (bmap[db_] / bmap[da] - 1)

    return {"reaction": ret(i - 1, i), "drift20": ret(i, i + 20), "drift60": ret(i, i + 60)}


# ---------------------------------------------------------------- signals


def _fq_label(fy: int, fq: int) -> str:
    return f"FY{fy}Q{fq}"


def _company_events(db: Db, c: dict[str, Any], prices: Prices) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cik, ticker, etf = c["cik"], c["ticker"], c.get("sector_etf") or "SPY"
    stock, bench = prices.series(ticker), prices.series(etf)
    if len(stock[0]) < 100 or len(bench[0]) < 100:
        return out
    events = db.select("earnings_events", {"cik": f"eq.{cik}", "select": "*", "order": "report_date", "limit": "400"})
    by_q = {(e["fiscal_year"], e["fiscal_quarter"]): e for e in events}

    def add(signal: str, when: str, before_open: bool, value: float, label: str) -> None:
        r = event_returns(stock, bench, date.fromisoformat(str(when)[:10]), before_open)
        if r["reaction"] is None:
            return
        out.append(
            {
                "id": f"{signal}:{cik}:{str(when)[:10]}",
                "signal": signal,
                "cik": cik,
                "ticker": ticker,
                "event_date": str(when)[:10],
                "label": label,
                "value": value,
                "benchmark": etf,
                **r,
            }
        )

    # 1. earnings surprise
    for e in events:
        if (
            e.get("eps_reported") is not None
            and e.get("eps_estimated")
            and e["eps_estimated"] > 0
            and e.get("report_date")
        ):
            add(
                "eps_surprise",
                e["report_date"],
                e.get("report_time") == "pre-market",
                e["eps_reported"] / e["eps_estimated"] - 1,
                _fq_label(e["fiscal_year"], e["fiscal_quarter"]),
            )
    # 2. revenue acceleration (quarterly XBRL)
    rev = db.select(
        "metric_values",
        {
            "cik": f"eq.{cik}",
            "metric": "eq.revenue",
            "fiscal_period": "in.(Q1,Q2,Q3,Q4)",
            "select": "fiscal_year,fiscal_period,value",
        },
    )
    rv = {(r["fiscal_year"], int(r["fiscal_period"][1])): float(r["value"]) for r in rev}

    def yoy(fy: int, fq: int) -> float | None:
        a, b = rv.get((fy - 1, fq)), rv.get((fy, fq))
        return b / a - 1 if a and b and a > 0 else None

    for (fy, fq), e in by_q.items():
        pfy, pfq = (fy, fq - 1) if fq > 1 else (fy - 1, 4)
        g, gp = yoy(fy, fq), yoy(pfy, pfq)
        if g is not None and gp is not None and e.get("report_date"):
            add("rev_accel", e["report_date"], e.get("report_time") == "pre-market", g - gp, _fq_label(fy, fq))
    # 3–4. call tone and hedging vs. same quarter a year earlier (free; from stored transcripts)
    calls = db.select("call_analysis", {"cik": f"eq.{cik}", "select": "fiscal_year,fiscal_quarter,tone"})
    tone = {}
    for r in calls:
        ex = ((r.get("tone") or {}).get("executives") or {}).get("all") or {}
        if ex.get("words", 0) >= 500:
            tone[(r["fiscal_year"], r["fiscal_quarter"])] = ex
    for (fy, fq), t in tone.items():
        p, ce = tone.get((fy - 1, fq)), by_q.get((fy, fq))
        if p and ce and ce.get("report_date"):
            pre = ce.get("report_time") == "pre-market"
            add("tone_change", ce["report_date"], pre, t["net_tone"] - p["net_tone"], _fq_label(fy, fq))
            add(
                "hedging_change",
                ce["report_date"],
                pre,
                (t["uncertainty_rate"] - p["uncertainty_rate"]) * 100,
                _fq_label(fy, fq),
            )
    # 5–6. risk factors, 10-K vs prior 10-K (event = filing date of the new 10-K)
    rcs = db.select("risk_comparisons", {"cik": f"eq.{cik}", "select": "accession_new,summary"})
    if rcs:
        filed = {
            f["accession"]: f["filed_date"]
            for f in db.select(
                "filings",
                {
                    "cik": f"eq.{cik}",
                    "accession": f"in.({','.join(r['accession_new'] for r in rcs)})",
                    "select": "accession,filed_date",
                },
            )
        }
        for r in rcs:
            fd = filed.get(r["accession_new"])
            s = r["summary"]
            if not fd or not s.get("factors_old"):
                return out
            lbl = f"10-K {str(s.get('report_new', ''))[:4]}"
            add("risk_escalated", fd, False, float(s.get("escalated", 0)), lbl)
            add("risk_added", fd, False, float((s.get("counts") or {}).get("added", 0)), lbl)
    # 7. guidance direction (where calls were compared)
    for r in db.select("call_comparisons", {"cik": f"eq.{cik}", "select": "period_b,result"}):
        gl: list[dict[str, Any]] = (r.get("result") or {}).get("guidance") or []
        net = sum(1 for x in gl if x.get("change") == "raised") - sum(
            1 for x in gl if x.get("change") in {"lowered", "withdrawn"}
        )
        fy, fq = int(r["period_b"][2:6]), int(r["period_b"][-1])
        ge = by_q.get((fy, fq))
        if ge and ge.get("report_date") and gl:
            add("guidance_net", ge["report_date"], ge.get("report_time") == "pre-market", float(net), r["period_b"])
    return out


def build_events(db: Db) -> list[dict[str, Any]]:
    companies = db.select("companies", {"select": "cik,ticker,sector_etf"})
    prices = Prices(db)
    out: list[dict[str, Any]] = []
    for c in companies:
        out += _company_events(db, c, prices)
    # one row per id
    return list({e["id"]: e for e in out}.values())


# ---------------------------------------------------------------- statistics


def _mean(xs: list[float]) -> float | None:
    return statistics.fmean(xs) if xs else None


def bootstrap_spread(hi: list[float], lo: list[float], n: int = 2000, seed: int = 7) -> tuple[float, float] | None:
    if len(hi) < 5 or len(lo) < 5:
        return None
    rng = random.Random(seed)
    diffs = []
    for _ in range(n):
        a = [hi[rng.randrange(len(hi))] for _ in hi]
        b = [lo[rng.randrange(len(lo))] for _ in lo]
        diffs.append(statistics.fmean(a) - statistics.fmean(b))
    diffs.sort()
    return diffs[int(0.025 * n)], diffs[int(0.975 * n) - 1]


def spearman(x: list[float], y: list[float]) -> float | None:
    if len(x) < 8:
        return None

    def ranks(v: list[float]) -> list[float]:
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(v):
            j = i
            while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2
            i = j + 1
        return r

    rx, ry = ranks(x), ranks(y)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry, strict=True))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else None


MIN_EVENTS = 20


def summarize(events: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for sd in SIGNALS:
        ev = [e for e in events if e["signal"] == sd.key]
        res: dict[str, Any] = {"n": len(ev), "companies": len({e["ticker"] for e in ev})}
        for horizon in ("reaction", "drift20", "drift60"):
            pts = [(e["value"], e[horizon]) for e in ev if e.get(horizon) is not None]
            if len(pts) < MIN_EVENTS:
                res[horizon] = {"n": len(pts), "enough": False}
                continue
            if sd.kind == "count":
                hi = [r for v, r in pts if v > 0]
                lo = [r for v, r in pts if v <= 0]
                cut = None
            else:
                vals = sorted(v for v, _ in pts)
                t1, t2 = vals[len(vals) // 3], vals[(2 * len(vals)) // 3]
                hi = [r for v, r in pts if v >= t2]
                lo = [r for v, r in pts if v < t1]
                cut = [t1, t2]
            mh, ml = _mean(hi), _mean(lo)
            ci = bootstrap_spread(hi, lo)
            spread = mh - ml if mh is not None and ml is not None else None
            res[horizon] = {
                "n": len(pts),
                "enough": ci is not None,
                "high_mean": mh,
                "low_mean": ml,
                "high_n": len(hi),
                "low_n": len(lo),
                "spread": spread,
                "ci": list(ci) if ci else None,
                "significant": bool(ci and (ci[0] > 0 or ci[1] < 0)),
                "high_hit": sum(1 for r in hi if r > 0) / len(hi) if hi else None,
                "low_hit": sum(1 for r in lo if r > 0) / len(lo) if lo else None,
                "spearman": spearman([v for v, _ in pts], [r for _, r in pts]),
                "cutoffs": cut,
            }
        out[sd.key] = res
    return out


def verdict(res: dict[str, Any]) -> str:
    d = [res.get(h) or {} for h in ("drift20", "drift60")]
    if not any(x.get("enough") for x in d):
        return "not_enough_data"
    if any(x.get("significant") for x in d):
        return "edge"
    return "no_edge"


# ---------------------------------------------------------------- collection (free limits)


def collect(settings: Settings, max_annual: int = 40) -> dict[str, Any]:
    """Grow the history the backtest needs, within free limits:
    - Street EPS history for companies that don't have it (Alpha Vantage, 1 call each),
    - call transcripts for the last 12 quarters (Alpha Vantage, leaving a daily reserve for you),
    - risk-factor comparisons for consecutive 10-Ks since 2014 (SEC, free; only risk factors stored)."""
    from ei.calls.run import AvQuota, analyze_call, ensure_events
    from ei.filings.run import ANNUAL, Fetcher, risk_compare
    from ei.jobs import Job
    from ei.transcripts import AlphaVantageProvider, QuotaReached

    db = Db(settings.supabase_url, settings.supabase_secret_key)
    job = Job(db, "backtest", "ALL", None)
    report: dict[str, Any] = {"events": [], "transcripts": 0, "no_transcript": 0, "risk_pairs": 0, "errors": []}
    etfs = {r["sector_etf"] for r in db.select("companies", {"select": "sector_etf"}) if r.get("sector_etf")} | {"SPY"}
    companies = [
        c for c in db.select("companies", {"select": "*", "order": "is_primary.desc,ticker"}) if c["ticker"] not in etfs
    ]
    job.step("history", "running", f"{len(companies)} companies")
    av = AlphaVantageProvider(
        settings.alpha_vantage_api_key, quota_check=AvQuota(db, AlphaVantageProvider.daily_limit, reserve=USER_RESERVE)
    )
    try:
        have = {r["cik"] for r in db.select("earnings_events", {"select": "cik"})}
        for c in companies:
            if c["cik"] not in have:
                try:
                    ensure_events(db, av, c)
                    report["events"].append(c["ticker"])
                except QuotaReached:
                    raise
                except Exception as err:  # one company's data problem shouldn't stop the rest
                    report["errors"].append(f"{c['ticker']} earnings: {type(err).__name__}")
        # round-robin newest-first so every company gets coverage
        done = {
            (r["cik"], r["fiscal_year"], r["fiscal_quarter"])
            for r in db.select("call_analysis", {"select": "cik,fiscal_year,fiscal_quarter", "limit": "5000"})
        }
        missing = {
            (r["cik"], r["fiscal_year"], r["fiscal_quarter"])
            for r in db.select(
                "transcripts", {"select": "cik,fiscal_year,fiscal_quarter", "turns": "eq.[]", "limit": "5000"}
            )
        }
        queues = []
        for c in companies:
            ev = db.select(
                "earnings_events",
                {
                    "cik": f"eq.{c['cik']}",
                    "select": "*",
                    "order": "report_date.desc",
                    "limit": str(TRANSCRIPT_QUARTERS),
                },
            )
            queues.append(
                [(c, e) for e in ev if (c["cik"], e["fiscal_year"], e["fiscal_quarter"]) not in done | missing]
            )
        while any(queues):
            for q in queues:
                if not q:
                    continue
                c, e = q.pop(0)
                try:
                    analyze_call(db, av, None, c, int(e["fiscal_year"]), int(e["fiscal_quarter"]), e, free_only=True)
                    report["transcripts"] += 1
                except LookupError:
                    report["no_transcript"] += 1
                except QuotaReached:
                    raise
                except Exception as err:
                    report["errors"].append(f"{c['ticker']} transcript: {type(err).__name__}")
    except QuotaReached:
        report["paused"] = "Transcript allowance for today used (reserve kept for your own briefs)"
    finally:
        av.close()
    job.step(
        "history",
        "done",
        f"Earnings history added: {len(report['events'])} · transcripts added: {report['transcripts']}"
        + (f" · {report['paused']}" if report.get("paused") else ""),
    )
    job.step("risk", "running", "Comparing risk factors in consecutive 10-Ks (SEC, free)")
    fetch = Fetcher(settings, db)
    try:
        budget = max_annual
        for c in companies:
            annual = [
                f
                for f in db.select(
                    "filings",
                    {
                        "cik": f"eq.{c['cik']}",
                        "form": f"in.({','.join(ANNUAL)})",
                        "select": "*",
                        "order": "report_date",
                    },
                )
                if f.get("report_date")
                and int(str(f["report_date"])[:4]) >= HISTORY_FROM
                and not f["form"].endswith("/A")
            ]
            done_pairs = {
                r["accession_new"]
                for r in db.select("risk_comparisons", {"cik": f"eq.{c['cik']}", "select": "accession_new"})
            }
            for old, new in itertools.pairwise(annual):
                if new["accession"] in done_pairs:
                    continue
                if budget <= 0:
                    report["risk_paused"] = f"Parsed {max_annual} annual reports this run; continues next run"
                    break
                budget -= 2
                try:
                    so = fetch.sections(old, c["cik"], only={"risk_factors"})
                    sn = fetch.sections(new, c["cik"], only={"risk_factors"})
                    ro, rn = so.get("risk_factors") or {}, sn.get("risk_factors") or {}
                    if ro.get("risk_factors") and rn.get("risk_factors"):
                        risk_compare(
                            db,
                            c["cik"],
                            {**rn, "report_date": new["report_date"]},
                            {**ro, "report_date": old["report_date"]},
                        )
                        report["risk_pairs"] += 1
                except Exception as e:
                    report["errors"].append(
                        f"{c['ticker']} {new['report_date']} 10-K: {type(e).__name__}: {str(e)[:80]}"
                    )
            if budget <= 0:
                break
    finally:
        fetch.close()
    job.step(
        "risk",
        "done",
        f"{report['risk_pairs']} 10-K pairs compared"
        + (f" · {report['risk_paused']}" if report.get("risk_paused") else ""),
    )
    if report["errors"]:
        job.step("skipped", "done", f"{len(report['errors'])} skipped: " + "; ".join(report["errors"][:6]))
    job.finish("done", None, None)
    return report


def run(settings: Settings) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    events = build_events(db)
    for i in range(0, len(events), 500):
        db.upsert("backtest_events", events[i : i + 500], on_conflict="id")
    summary = summarize(events)
    coverage: dict[str, Any] = {
        "events": len(events),
        "companies": len({e["ticker"] for e in events}),
        "first": min((e["event_date"] for e in events), default=None),
        "last": max((e["event_date"] for e in events), default=None),
        "signals": {
            k: {
                "title": s.title,
                "explain": s.explain,
                "unit": s.unit,
                "kind": s.kind,
                "high_label": s.high_label,
                "low_label": s.low_label,
                "verdict": verdict(summary[k]),
            }
            for k, s in BY_KEY.items()
        },
    }
    db.insert("backtest_results", {"summary": summary, "coverage": coverage})
    return {"events": len(events), "verdicts": {k: v["verdict"] for k, v in coverage["signals"].items()}}
