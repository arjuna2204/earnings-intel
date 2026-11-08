"""Filings + Brief job: pick the filings for two fiscal quarters, parse them, redline risk factors,
extract earnings-release figures and MD&A drivers (Haiku), then write the brief (Sonnet).

Everything is cached: re-running costs nothing unless a new filing or a new prompt version appears.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from ei.ai import AiClient
from ei.budget import BudgetExceeded
from ei.calls.extract import ANALYSIS_VERSION
from ei.calls.run import compare_calls, label, parse_period
from ei.config import Settings
from ei.db import Db
from ei.embed import default_embedder
from ei.filings import brief as brief_mod
from ei.filings.mdna import VERSION as MDNA_VERSION
from ei.filings.mdna import extract_mdna
from ei.filings.release import VERSION as RELEASE_VERSION
from ei.filings.release import extract_release
from ei.filings.risk import RiskFactor, compare_risk_factors, split_risk_factors
from ei.filings.text import extract_sections, html_to_blocks
from ei.http import get_with_retries
from ei.jobs import Job
from ei.sec import SEC_LIMITER, SecClient

log = logging.getLogger(__name__)
PARSER_VERSION = "parse-v2"
RISK_VERSION = "risk-v1"
ANNUAL = {"10-K", "10-K/A", "20-F", "20-F/A"}
QUARTERLY = {"10-Q", "10-Q/A"}


def _d(x: Any) -> date:
    return date.fromisoformat(str(x)[:10])


def period_end(db: Db, cik: int, fy: int, fq: int) -> date | None:
    rows = db.select(
        "metric_values",
        {
            "cik": f"eq.{cik}",
            "fiscal_year": f"eq.{fy}",
            "fiscal_period": f"eq.Q{fq}",
            "select": "period_end",
            "limit": "1",
        },
    )
    if rows:
        return _d(rows[0]["period_end"])
    if fq == 4:
        rows = db.select(
            "metric_values",
            {
                "cik": f"eq.{cik}",
                "fiscal_year": f"eq.{fy}",
                "fiscal_period": "eq.FY",
                "select": "period_end",
                "limit": "1",
            },
        )
        return _d(rows[0]["period_end"]) if rows else None
    return None


def pick_filings(filings: list[dict[str, Any]], end: date, fq: int, foreign: bool) -> dict[str, dict[str, Any] | None]:
    """The periodic report for the quarter, the annual report whose risk factors apply, and the
    earnings release (8-K item 2.02, or a 6-K for foreign filers) filed soon after quarter end."""

    def near(f: dict[str, Any], days: int = 15) -> bool:
        return f.get("report_date") is not None and abs((_d(f["report_date"]) - end).days) <= days

    forms = ANNUAL if fq == 4 or foreign else QUARTERLY
    periodic = next((f for f in filings if f["form"] in forms and near(f)), None)
    if periodic is None and foreign:
        periodic = None  # 20-F covers the fiscal year only
    annual = [
        f
        for f in filings
        if f["form"] in ANNUAL and f.get("report_date") and _d(f["report_date"]) <= end + timedelta(days=15)
    ]
    risk = max(annual, key=lambda f: str(f["report_date"]), default=None)
    win = [f for f in filings if end <= _d(f["filed_date"]) <= end + timedelta(days=75)]
    release = min(
        (f for f in win if f["form"] == "8-K" and "2.02" in (f.get("items") or "")),
        key=lambda f: str(f["filed_date"]),
        default=None,
    )
    if release is None and foreign:
        release = min((f for f in win if f["form"] == "6-K"), key=lambda f: str(f["filed_date"]), default=None)
    return {"periodic": periodic, "risk": risk, "release": release}


class Fetcher:
    def __init__(self, settings: Settings, db: Db) -> None:
        self.sec = SecClient(settings.sec_user_agent)
        self.db = db

    def close(self) -> None:
        self.sec.close()

    def html(self, url: str) -> str:
        return get_with_retries(self.sec._client, url, limiter=SEC_LIMITER).text

    def exhibit_99_url(self, filing: dict[str, Any]) -> str | None:
        base = filing["url"].rsplit("/", 1)[0]
        idx = get_with_retries(self.sec._client, f"{base}/index.json", limiter=SEC_LIMITER).json()
        names = [i["name"] for i in idx.get("directory", {}).get("item", [])]
        htm = [n for n in names if n.lower().endswith((".htm", ".html")) and "index" not in n.lower()]
        ex = [n for n in htm if "99" in n.lower() and "99.2" not in n.lower() and "992" not in n.lower()]
        pick = ex[0] if ex else None
        return f"{base}/{pick}" if pick else None

    def sections(self, filing: dict[str, Any], cik: int, only: set[str] | None = None) -> dict[str, dict[str, Any]]:
        """Parsed sections of a periodic report, cached in filing_sections. With `only`, just those
        sections are stored (the backtest keeps risk factors of old 10-Ks without their full text);
        such partial rows are marked so a later full request re-parses the document."""
        acc = filing["accession"]
        versions = [PARSER_VERSION] + ([PARSER_VERSION + "-partial"] if only else [])
        rows = self.db.select(
            "filing_sections",
            {"accession": f"eq.{acc}", "parser_version": f"in.({','.join(versions)})", "select": "*"},
        )
        if rows and (only is None or only <= {r["section"] for r in rows} or rows[0].get("title") == "__none__"):
            return {r["section"]: r for r in rows}
        secs = extract_sections(filing["form"], self.html(filing["url"]))
        out: dict[str, dict[str, Any]] = {}
        for name, sec in secs.items():
            if only is not None and name not in only:
                continue
            row = {
                "accession": acc,
                "cik": cik,
                "section": name,
                "form": filing["form"],
                "report_date": filing.get("report_date"),
                "title": sec.title,
                "paragraphs": [] if only else [b.text for b in sec.blocks],
                "risk_factors": [rf.__dict__ for rf in split_risk_factors(sec)] if name == "risk_factors" else None,
                "parser_version": PARSER_VERSION + ("-partial" if only else ""),
            }
            out[name] = row
        if out:
            self.db.upsert("filing_sections", list(out.values()), on_conflict="accession,section")
        return out

    def release(self, filing: dict[str, Any], cik: int) -> dict[str, Any] | None:
        acc = filing["accession"]
        rows = self.db.select("filing_sections", {"accession": f"eq.{acc}", "section": "eq.release", "select": "*"})
        if rows:
            return rows[0]
        url = self.exhibit_99_url(filing)
        if not url:
            return None
        blocks = html_to_blocks(self.html(url))
        row = {
            "accession": acc,
            "cik": cik,
            "section": "release",
            "form": filing["form"],
            "report_date": filing.get("filed_date"),
            "title": url,  # the exhibit URL, for source links
            "paragraphs": [b.text for b in blocks],
            "risk_factors": None,
            "parser_version": PARSER_VERSION,
        }
        self.db.upsert("filing_sections", [row], on_conflict="accession,section")
        return row


def _factors(row: dict[str, Any] | None) -> list[RiskFactor]:
    return [RiskFactor(**f) for f in (row or {}).get("risk_factors") or []]


def risk_compare(db: Db, cik: int, new: dict[str, Any], old: dict[str, Any]) -> dict[str, Any]:
    key = {"cik": cik, "accession_new": new["accession"], "accession_old": old["accession"], "version": RISK_VERSION}
    rows = db.select("risk_comparisons", {k: f"eq.{v}" for k, v in key.items()} | {"select": "*"})
    if rows:
        return rows[0]
    nf, of = _factors(new), _factors(old)
    changes = [c.as_row() for c in compare_risk_factors(nf, of, default_embedder())]
    counts: dict[str, int] = {}
    for c in changes:
        counts[c["status"]] = counts.get(c["status"], 0) + 1
    summary = {
        "counts": counts,
        "escalated": sum(1 for c in changes if c["escalations"]),
        "factors_new": len(nf),
        "factors_old": len(of),
        "words_new": sum(len(f.text.split()) for f in nf),
        "words_old": sum(len(f.text.split()) for f in of),
        "report_new": new.get("report_date"),
        "report_old": old.get("report_date"),
        "embedder": default_embedder().name,
    }
    row = {**key, "summary": summary, "changes": changes}
    db.upsert("risk_comparisons", [row], on_conflict="cik,accession_new,accession_old,version")
    return row


def cached_analysis(db: Db, acc: str, kind: str, version: str) -> dict[str, Any] | None:
    rows = db.select(
        "filing_analysis", {"accession": f"eq.{acc}", "kind": f"eq.{kind}", "version": f"eq.{version}", "select": "*"}
    )
    return rows[0] if rows else None


def _metric_table(
    db: Db, cik: int, periods: list[tuple[int, int]]
) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    names = [m for m, _, _ in brief_mod.X_METRICS]
    vals: dict[str, dict[str, float]] = {}
    notes: dict[str, str] = {}
    for fy, fq in periods:
        rows = db.select(
            "metric_values",
            {
                "cik": f"eq.{cik}",
                "fiscal_year": f"eq.{fy}",
                "fiscal_period": f"eq.Q{fq}",
                "metric": f"in.({','.join(names)})",
                "select": "metric,value,derivation",
            },
        )
        for r in rows:
            vals.setdefault(r["metric"], {})[label(fy, fq)] = float(r["value"])
            if r["metric"].startswith("adj_") and r.get("derivation"):
                notes[r["metric"]] = r["derivation"]
    return vals, notes


def run_brief(
    settings: Settings, ticker: str, period_a: str, period_b: str, job_id: int | None = None
) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    job = Job(db, "brief", ticker.upper(), job_id)
    ai = AiClient(settings.anthropic_api_key, db) if settings.anthropic_api_key else None
    (fa, qa), (fb, qb) = sorted([parse_period(period_a), parse_period(period_b)])
    la, lb = label(fa, qa), label(fb, qb)
    fetch = Fetcher(settings, db)
    notes: list[str] = []
    try:
        comp = db.select("companies", {"ticker": f"eq.{ticker.upper()}", "select": "*"})
        if not comp:
            raise RuntimeError("Load the company first")
        company = comp[0]
        cik, foreign = company["cik"], company.get("filer_type") == "foreign"

        job.step("filings", "running", "Finding the 10-K/10-Q, annual report and earnings release for each quarter")
        sub = fetch.sec.submissions(cik)["filings"]["recent"]
        items = {sub["accessionNumber"][i]: sub["items"][i] for i in range(len(sub["form"])) if sub.get("items")}
        filings = db.select("filings", {"cik": f"eq.{cik}", "select": "*", "order": "filed_date.desc", "limit": "400"})
        for f in filings:
            f["items"] = f.get("items") or items.get(f["accession"])
        picks: dict[str, dict[str, Any]] = {}
        for fy, fq in ((fa, qa), (fb, qb)):
            end = period_end(db, cik, fy, fq)
            if end is None:
                raise RuntimeError(f"No financial data for {label(fy, fq)} yet")
            picks[label(fy, fq)] = {"end": end, **pick_filings(filings, end, fq, foreign)}
        desc = []
        for lbl, p in picks.items():
            have = [k for k in ("periodic", "release") if p.get(k)]
            desc.append(f"{lbl}: " + (", ".join(f"{p[k]['form']}" for k in have) or "none found"))
        job.step("filings", "done", " · ".join(desc))

        job.step("parse", "running", "Downloading and splitting into sections (no AI)")
        secs: dict[str, dict[str, dict[str, Any]]] = {}
        rel_rows: dict[str, dict[str, Any] | None] = {}
        risk_secs: dict[str, dict[str, Any] | None] = {}
        for lbl, p in picks.items():
            secs[lbl] = fetch.sections(p["periodic"], cik) if p.get("periodic") else {}
            rk = fetch.sections(p["risk"], cik) if p.get("risk") else {}
            risk_secs[lbl] = (
                {**rk["risk_factors"], "report_date": p["risk"]["report_date"]} if "risk_factors" in rk else None
            )
            rel_rows[lbl] = fetch.release(p["release"], cik) if p.get("release") else None
        job.step("parse", "done", " · ".join(f"{k}: {', '.join(v) or '—'}" for k, v in secs.items()))

        job.step("risks", "running", "Matching and redlining risk factors (no AI)")
        risk = None
        ra, rb = risk_secs.get(la), risk_secs.get(lb)
        if ra and rb and ra["accession"] != rb["accession"]:
            risk = risk_compare(db, cik, rb, ra)
            c = risk["summary"]["counts"]
            job.step(
                "risks",
                "done",
                f"{c.get('added', 0)} added · {c.get('removed', 0)} removed · {c.get('modified', 0)} reworded · {risk['summary']['escalated']} escalated",
            )
        else:
            job.step(
                "risks", "done", "Both quarters fall under the same annual report — no risk-factor change to compare"
            )
            notes.append("same_annual_report")

        results: dict[str, dict[str, Any]] = {}
        for lbl, p in picks.items():
            out: dict[str, Any] = {}
            rel = rel_rows.get(lbl)
            if rel and p.get("release"):
                job.step(f"release {lbl}", "running", "Company GAAP and non-GAAP figures from the earnings release")
                cached = cached_analysis(db, rel["accession"], "release", RELEASE_VERSION)
                if cached is None and ai is not None:
                    r = extract_release(ai, rel["paragraphs"], company["name"], lbl, cik)
                    cached = {
                        "accession": rel["accession"],
                        "cik": cik,
                        "kind": "release",
                        "version": RELEASE_VERSION,
                        "period": lbl,
                        "result": r["kept"],
                        "dropped": r["dropped"],
                        "raw": r["raw"],
                        "cost_usd": r["cost_usd"],
                    }
                    db.upsert("filing_analysis", [cached], on_conflict="accession,kind,version")
                out["release"] = cached["result"] if cached else None
                n = len(out["release"]["figures"]) if out["release"] else 0
                job.step(
                    f"release {lbl}",
                    "done",
                    f"{n} verified figures"
                    + (" · non-GAAP reported" if out["release"] and out["release"]["reports_non_gaap"] else ""),
                )
            s = secs.get(lbl, {})
            if "mdna" in s:
                job.step(f"mdna {lbl}", "running", "What management says drove results")
                acc = s["mdna"]["accession"]
                cached = cached_analysis(db, acc, "mdna", MDNA_VERSION)
                if cached is None and ai is not None:
                    biz = (s.get("business") or {}).get("paragraphs") or []
                    if not biz and risk_secs.get(lbl):
                        rk = fetch.sections(p["risk"], cik)
                        biz = (rk.get("business") or {}).get("paragraphs") or []
                    r = extract_mdna(ai, s["mdna"]["paragraphs"], biz, company["name"], lbl, cik)
                    cached = {
                        "accession": acc,
                        "cik": cik,
                        "kind": "mdna",
                        "version": MDNA_VERSION,
                        "period": lbl,
                        "result": {**r["kept"], "paragraphs": r["paragraphs"]},
                        "dropped": r["dropped"],
                        "raw": r["raw"],
                        "cost_usd": r["cost_usd"],
                    }
                    db.upsert("filing_analysis", [cached], on_conflict="accession,kind,version")
                out["mdna"] = cached["result"] if cached else None
                job.step(f"mdna {lbl}", "done", f"{len((out['mdna'] or {}).get('drivers', []))} drivers")
            results[lbl] = out

        job.step("call", "running", "Earnings call comparison")
        cc = db.select(
            "call_comparisons",
            {
                "cik": f"eq.{cik}",
                "period_a": f"eq.{la}",
                "period_b": f"eq.{lb}",
                "analysis_version": f"eq.{ANALYSIS_VERSION}",
                "select": "result",
            },
        )
        if not cc:
            try:
                compare_calls(settings, ticker, la, lb)
                cc = db.select(
                    "call_comparisons",
                    {
                        "cik": f"eq.{cik}",
                        "period_a": f"eq.{la}",
                        "period_b": f"eq.{lb}",
                        "analysis_version": f"eq.{ANALYSIS_VERSION}",
                        "select": "result",
                    },
                )
            except Exception as e:  # quota or missing transcript: brief continues without the call
                log.warning("call comparison failed: %s", e)
        call = cc[0]["result"] if cc else None
        job.step(
            "call",
            "done" if call else "partial",
            "included" if call else "not available (transcript limit or missing) — brief uses filings and numbers only",
        )

        job.step("brief", "running", "Writing the brief from verified facts (Sonnet)")
        ev_rows = db.select("earnings_events", {"cik": f"eq.{cik}", "select": "*"})
        events = {label(e["fiscal_year"], e["fiscal_quarter"]): e for e in ev_rows}
        vals, mnotes = _metric_table(db, cik, [(fa, qa), (fb, qb)])
        facts = brief_mod.assemble(
            {
                "S": brief_mod.street_facts(
                    results[lb].get("release"),
                    results[la].get("release"),
                    events,
                    lb,
                    la,
                    company.get("valuation") or {},
                ),
                "X": brief_mod.xbrl_facts(vals, la, lb, mnotes),
                "C": brief_mod.call_facts(call),
                "F": brief_mod.filing_facts(results[lb].get("mdna"), lb),
                "R": brief_mod.risk_facts(risk),
            }
        )
        existing = db.select(
            "briefs",
            {
                "cik": f"eq.{cik}",
                "period_a": f"eq.{la}",
                "period_b": f"eq.{lb}",
                "version": f"eq.{brief_mod.VERSION}",
                "select": "inputs",
            },
        )
        if existing and existing[0]["inputs"].get("facts") == facts:
            job.step("brief", "done", "Unchanged inputs — kept the existing brief (no cost)")
        elif ai is None:
            job.step("brief", "partial", "No Anthropic key configured")
        else:
            b = brief_mod.write_brief(ai, facts, company["name"], la, lb, cik)
            inputs = {
                "facts": facts,
                "notes": notes,
                "filings": {
                    k: {
                        kk: (
                            str(v[kk])
                            if kk == "end"
                            else (
                                v[kk]
                                and {x: v[kk].get(x) for x in ("accession", "form", "filed_date", "report_date", "url")}
                            )
                        )
                        for kk in ("end", "periodic", "risk", "release")
                    }
                    for k, v in picks.items()
                },
                "results": results,
                "risk": {
                    "summary": risk["summary"],
                    "accession_new": risk["accession_new"],
                    "accession_old": risk["accession_old"],
                }
                if risk
                else None,
            }
            db.upsert(
                "briefs",
                [
                    {
                        "cik": cik,
                        "period_a": la,
                        "period_b": lb,
                        "version": brief_mod.VERSION,
                        "inputs": inputs,
                        "claims": b["claims"],
                        "dropped": b["dropped"],
                        "raw": b["raw"],
                        "cost_usd": b["cost_usd"],
                    }
                ],
                on_conflict="cik,period_a,period_b,version",
            )
            job.step(
                "brief",
                "done",
                f"{len(b['claims'])} verified claims · {len(b['dropped'])} dropped · ${b['cost_usd']:.4f}",
            )
        job.finish("done", None, cik)
        return {"ok": True}
    except BudgetExceeded as e:
        job.finish("failed", str(e))
        return {"ok": False, "error": str(e)}
    except Exception as e:
        job.finish("failed", f"{type(e).__name__}: {e}")
        raise
    finally:
        fetch.close()
