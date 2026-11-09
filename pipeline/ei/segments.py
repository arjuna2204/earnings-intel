"""Revenue (and operating income) by business segment, product line and region, from SEC XBRL.

SEC's companyfacts API leaves out "dimensional" facts — the ones broken out by segment — so they are
read from each filing's own XBRL instance (the `_htm.xml` file EDGAR extracts from inline XBRL),
with names from the filing's label file. Only facts split along exactly one of three standard axes
are kept, so cross-tabs (e.g. a product within a region) never double count. All arithmetic is code.

Sources: the last three 10-Ks (annual figures for ~5 years) and last six 10-Qs (quarters).
Q4 = full year minus Q1–Q3 for the same line, when all three are reported.
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from itertools import combinations
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
    # one element's labels (standard, terse, documentation...) usually share a single xlink:label
    text: dict[str, list[tuple[str, str]]] = {}
    for el in root.iter("{*}label"):
        if el.get(f"{XLINK}type") not in (None, "resource"):
            continue
        text.setdefault(el.get(f"{XLINK}label", ""), []).append((el.get(f"{XLINK}role", ""), (el.text or "").strip()))
    out: dict[str, str] = {}
    terse: dict[str, str] = {}
    for arc in root.iter("{*}labelArc"):
        name = loc.get(arc.get(f"{XLINK}from", ""))
        if not name:
            continue
        for role, raw in text.get(arc.get(f"{XLINK}to", ""), []):
            if not raw:
                continue
            clean = re.sub(r"\s*\[(Member|Domain)\]\s*$", "", raw).strip()
            if role.endswith("/role/label"):
                out[name] = clean
            elif role.endswith("/role/terseLabel"):
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
    cik: int,
    facts_by_filing: list[tuple[str, list[SegFact]]],
    labels: dict[str, str],
    fye: str,
    revenue_fy: dict[int, float] | None = None,
) -> list[dict[str, Any]]:
    """`revenue_fy`: company total revenue by fiscal year, to spot subtotal lines (see subtotal_members)."""
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
                "adds_up": None,
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
    # drop subtotal lines, judged on the latest full year that has a breakdown and a company total
    rows = list(vals.values())
    revenue_fy = revenue_fy or {}
    for axis in {r["axis"] for r in rows if r["measure"] == "revenue"}:
        years = sorted(
            {
                r["fiscal_year"]
                for r in rows
                if r["axis"] == axis and r["measure"] == "revenue" and r["fiscal_period"] == "FY"
            },
            reverse=True,
        )
        year = next((y for y in years if y in revenue_fy), None)
        if year is None:
            continue
        members = {
            r["member"]: r["value"]
            for r in rows
            if r["axis"] == axis
            and r["measure"] == "revenue"
            and r["fiscal_period"] == "FY"
            and r["fiscal_year"] == year
        }
        drop, adds_up = subtotal_members(members, revenue_fy[year])
        if not adds_up and sum(members.values()) > 1.02 * revenue_fy[year]:
            # lines overlap in ways we can't untangle (Tesla tags totals at several levels): showing them
            # stacked would overstate revenue, so this breakdown is left out
            rows = [r for r in rows if not (r["axis"] == axis and r["measure"] == "revenue")]
            continue
        rows = [r for r in rows if not (r["axis"] == axis and r["member"] in drop)]
        for r in rows:
            if r["axis"] == axis and r["measure"] == "revenue":
                r["adds_up"] = adds_up
    return rows


def subtotal_members(members: dict[str, float], total: float | None, tol: float = 0.02) -> tuple[set[str], bool]:
    """Lines to drop so one year's breakdown adds up to total revenue, and whether it then adds up.

    Companies often tag subtotals on the same axis as their parts (Apple: "Products" next to iPhone,
    Mac, iPad; NVIDIA: "Data Center" next to Compute and Networking), which would double count.
    Try dropping no line, then one, then two, and keep the smallest fix (ties: drop the bigger lines,
    since subtotals are bigger than their parts)."""
    if not total or total <= 0 or len(members) < 2:
        return set(), True
    names = list(members)
    full = sum(members.values())

    def ok(drop: tuple[str, ...]) -> bool:
        return abs(full - sum(members[d] for d in drop) - total) <= tol * total

    if ok(()):
        return set(), True
    if full < total:  # some revenue isn't broken out (an "other" bucket left untagged): nothing overlaps
        return set(), False
    for size in (1, 2):
        fixes = [c for c in combinations(names, size) if ok(c)]
        if fixes:
            best = max(fixes, key=lambda c: sum(members[d] for d in c))
            return set(best), True
    return set(), False


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
    diag: list[str] = []
    for f in _pick_filings(db, cik):
        # file names vary (msft-10k_20260630.htm vs msft-20260630_lab.xml), so read the filing's index
        try:
            idx = sec.text(archive_url(cik, f["accession"], "index.json"))
            names = [i["name"] for i in json.loads(idx)["directory"]["item"]]
        except Exception as exc:
            log.info("no index for %s: %s", f["accession"], exc)
            continue
        inst = next((n for n in names if n.endswith("_htm.xml")), None)
        lab = next((n for n in names if n.endswith("_lab.xml")), None)
        if not inst:  # older, non-inline filings have no extracted instance
            continue
        try:
            facts = parse_instance(sec.text(archive_url(cik, f["accession"], inst)).encode())
        except Exception as exc:
            log.info("instance unreadable for %s: %s", f["accession"], exc)
            continue
        by_filing.append((f["accession"], facts))
        if facts and not lab:
            diag.append(f"no _lab.xml among {len(names)} files")
        if facts and lab:
            try:
                got = parse_labels(sec.text(archive_url(cik, f["accession"], lab)).encode())
                diag.append(f"{lab}: {len(got)} labels")
                labels.update(got)
            except Exception as exc:
                log.info("no label file for %s: %s", f["accession"], exc)
    revenue_fy = {
        int(r["fiscal_year"]): float(r["value"])
        for r in db.select(
            "metric_values",
            {"cik": f"eq.{cik}", "metric": "eq.revenue", "fiscal_period": "eq.FY", "select": "fiscal_year,value"},
        )
    }
    rows = build_rows(cik, by_filing, labels, fye, revenue_fy)
    db.replace_rows(
        "segment_values", {"cik": cik}, rows, on_conflict="cik,axis,measure,member,fiscal_year,fiscal_period"
    )
    axes = sorted({r["axis"] for r in rows})
    members = {r["member"] for r in rows}
    unnamed = sorted(m for m in members if m not in labels)
    return {
        "filings": len(by_filing),
        "rows": len(rows),
        "axes": axes,
        "unnamed": unnamed[:5],
        "label_sample": sorted(labels)[:3] if unnamed else [],
        "diag": diag[-3:] if unnamed else [],
    }


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
