"""Revenue (and operating income) by business segment, product line and region, from SEC XBRL.

SEC's companyfacts API leaves out "dimensional" facts — the ones broken out by segment — so they are
read from each filing's own XBRL instance (the `_htm.xml` file EDGAR extracts from inline XBRL),
with names from the filing's label file. Only facts split along exactly one of three standard axes
are kept, so cross-tabs (e.g. a product within a region) never double count. All arithmetic is code.

Sources: the last three 10-Ks (annual figures for ~5 years) and last six 10-Qs (quarters).
Q4 = full year minus Q1–Q3 for the same line, when all three are reported.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Any

from lxml import etree

from ei.db import Db
from ei.sec import SecClient, archive_url
from ei.xbrl.normalize import QUARTER_DAYS, YEAR_DAYS, FiscalCalendar

log = logging.getLogger(__name__)

AXES = {
    "StatementBusinessSegmentsAxis": "segment",
    "ProductOrServiceAxis": "product",
    "StatementGeographicalAxis": "region",
}
REVENUE_TAGS = (
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "RevenuesNetOfInterestExpense",
)
OPINC_TAGS = ("OperatingIncomeLoss",)
MEASURES = {t: "revenue" for t in REVENUE_TAGS} | {t: "operating_income" for t in OPINC_TAGS}

XLINK = "{http://www.w3.org/1999/xlink}"


@dataclass(frozen=True)
class SegFact:
    concept: str
    axis: str  # segment | product | region
    member: str  # local element name, e.g. IPhoneMember
    start: date
    end: date
    value: float


def _local(qname: str) -> str:
    return qname.split(":", 1)[-1]


def parse_instance(xml: bytes) -> list[SegFact]:
    """Single-dimension revenue / operating-income facts on the three standard axes."""
    root = etree.fromstring(xml, parser=etree.XMLParser(huge_tree=True, recover=True))
    contexts: dict[str, tuple[date, date, str, str]] = {}
    for ctx in root.iter("{*}context"):
        start = ctx.find(".//{*}startDate")
        end = ctx.find(".//{*}endDate")
        if start is None or end is None or not start.text or not end.text:
            continue
        seg = ctx.find(".//{*}segment")
        if seg is None:
            continue
        members = list(seg)
        if len(members) != 1 or etree.QName(members[0]).localname != "explicitMember":
            continue
        axis = AXES.get(_local(members[0].get("dimension", "")))
        if not axis or not members[0].text:
            continue
        contexts[ctx.get("id", "")] = (
            date.fromisoformat(start.text.strip()[:10]),
            date.fromisoformat(end.text.strip()[:10]),
            axis,
            _local(members[0].text.strip()),
        )
    out: list[SegFact] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        ref = el.get("contextRef")
        if not ref or ref not in contexts:
            continue
        name = etree.QName(el).localname
        if name not in MEASURES or not el.text:
            continue
        unit = (el.get("unitRef") or "").lower()
        if "usd" not in unit or "share" in unit:
            continue
        try:
            value = float(el.text.strip())
        except ValueError:
            continue
        start, end, axis, member = contexts[ref]
        out.append(SegFact(name, axis, member, start, end, value))
    return out


def parse_labels(xml: bytes) -> dict[str, str]:
    """Element local name -> the company's standard label, without the ' [Member]' suffix."""
    root = etree.fromstring(xml, parser=etree.XMLParser(huge_tree=True, recover=True))
    loc: dict[str, str] = {}
    for el in root.iter("{*}loc"):
        href = el.get(f"{XLINK}href", "")
        frag = href.split("#", 1)[-1]
        loc[el.get(f"{XLINK}label", "")] = frag.split("_", 1)[-1] if "_" in frag else frag
    text: dict[str, tuple[str, str]] = {}
    for el in root.iter("{*}label"):
        if el.get(f"{XLINK}type") != "resource":
            continue
        role = el.get(f"{XLINK}role", "")
        text[el.get(f"{XLINK}label", "")] = (role, (el.text or "").strip())
    out: dict[str, str] = {}
    terse: dict[str, str] = {}
    for arc in root.iter("{*}labelArc"):
        name = loc.get(arc.get(f"{XLINK}from", ""))
        lab = text.get(arc.get(f"{XLINK}to", ""))
        if not name or not lab or not lab[1]:
            continue
        clean = re.sub(r"\s*\[(Member|Domain)\]\s*$", "", lab[1]).strip()
        if lab[0].endswith("/role/label"):
            out[name] = clean
        elif lab[0].endswith("/role/terseLabel"):
            terse[name] = clean
    return {**out, **terse}  # a terse label, when given, is what the company shows in its tables


def humanize(member: str) -> str:
    """Fallback name from the element name: 'DataCenterSegmentMember' -> 'Data Center'."""
    s = re.sub(r"(Segment)?Member$", "", member)
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    return s.strip() or member


def _kind(start: date, end: date) -> str | None:
    days = (end - start).days
    if QUARTER_DAYS[0] <= days <= QUARTER_DAYS[1]:
        return "Q"
    if YEAR_DAYS[0] <= days <= YEAR_DAYS[1]:
        return "FY"
    return None


def build_rows(
    cik: int, facts_by_filing: list[tuple[str, list[SegFact]]], labels: dict[str, str], fye: str
) -> list[dict[str, Any]]:
    """Rows for the segment_values table. `facts_by_filing` oldest first (later filings win)."""
    cal = FiscalCalendar.from_mmdd(fye)
    # per axis and measure, use the single concept with the most data so two revenue tags never mix
    counts: Counter[tuple[str, str, str]] = Counter()
    for _, facts in facts_by_filing:
        for f in facts:
            counts[(f.axis, MEASURES[f.concept], f.concept)] += 1
    chosen: dict[tuple[str, str], str] = {}
    for (axis, measure, concept), _n in counts.most_common():
        chosen.setdefault((axis, measure), concept)

    vals: dict[tuple[str, str, str, int, str], dict[str, Any]] = {}
    for acc, facts in facts_by_filing:
        for f in facts:
            measure = MEASURES[f.concept]
            if chosen.get((f.axis, measure)) != f.concept:
                continue
            kind = _kind(f.start, f.end)
            if not kind or not cal.is_quarter_end(f.end):
                continue
            fy, q = cal.label(f.end)
            fp = "FY" if kind == "FY" else f"Q{q}"
            if kind == "FY" and q != 4:
                continue
            vals[(f.axis, measure, f.member, fy, fp)] = {
                "cik": cik,
                "axis": f.axis,
                "measure": measure,
                "member": f.member,
                "label": labels.get(f.member) or humanize(f.member),
                "fiscal_year": fy,
                "fiscal_period": fp,
                "period_start": f.start.isoformat(),
                "period_end": f.end.isoformat(),
                "value": f.value,
                "source": "reported",
                "accession": acc,
            }
    # Q4 = FY − Q1..Q3 for the same line
    for (axis, measure, member, fy, fp), row in list(vals.items()):
        if fp != "FY" or (axis, measure, member, fy, "Q4") in vals:
            continue
        qs = [vals.get((axis, measure, member, fy, f"Q{i}")) for i in (1, 2, 3)]
        if all(qs):
            q3 = qs[2]
            assert q3 is not None
            vals[(axis, measure, member, fy, "Q4")] = {
                **row,
                "fiscal_period": "Q4",
                "period_start": None,
                "value": row["value"] - sum(q["value"] for q in qs if q),
                "source": "derived",
            }
    return list(vals.values())


def _pick_filings(db: Db, cik: int) -> list[dict[str, Any]]:
    rows = db.select(
        "filings",
        {
            "cik": f"eq.{cik}",
            "form": "in.(10-K,10-Q)",
            "select": "accession,form,filed_date,primary_doc",
            "order": "filed_date.desc",
            "limit": "40",
        },
    )
    annual = [r for r in rows if r["form"] == "10-K"][:3]
    quarterly = [r for r in rows if r["form"] == "10-Q"][:6]
    return sorted(annual + quarterly, key=lambda r: r["filed_date"])


def run_company(db: Db, sec: SecClient, company: dict[str, Any]) -> dict[str, Any]:
    cik = company["cik"]
    fye = company.get("fiscal_year_end") or "1231"
    by_filing: list[tuple[str, list[SegFact]]] = []
    labels: dict[str, str] = {}
    for f in _pick_filings(db, cik):
        doc = f.get("primary_doc") or ""
        if not doc.endswith((".htm", ".html")):
            continue
        base = re.sub(r"\.html?$", "", doc)
        try:
            xml = sec.text(archive_url(cik, f["accession"], f"{base}_htm.xml")).encode()
        except Exception as exc:  # older, non-inline filings have no extracted instance
            log.info("no XBRL instance for %s: %s", f["accession"], exc)
            continue
        facts = parse_instance(xml)
        by_filing.append((f["accession"], facts))
        if facts:
            try:
                labels.update(parse_labels(sec.text(archive_url(cik, f["accession"], f"{base}_lab.xml")).encode()))
            except Exception as exc:
                log.info("no label file for %s: %s", f["accession"], exc)
    rows = build_rows(cik, by_filing, labels, fye)
    db.replace_rows(
        "segment_values", {"cik": cik}, rows, on_conflict="cik,axis,measure,member,fiscal_year,fiscal_period"
    )
    axes = sorted({r["axis"] for r in rows})
    return {"filings": len(by_filing), "rows": len(rows), "axes": axes}


def run_all(settings: Any, tickers: list[str] | None = None) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    sec = SecClient(settings.sec_user_agent)
    out: dict[str, Any] = {}
    try:
        for c in db.select("companies", {"select": "cik,ticker,fiscal_year_end,currency"}):
            if tickers and c["ticker"] not in tickers:
                continue
            try:
                out[c["ticker"]] = run_company(db, sec, c)
            except Exception as e:
                out[c["ticker"]] = {"error": f"{type(e).__name__}: {e}"[:200]}
    finally:
        sec.close()
    return out
