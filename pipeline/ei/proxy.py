"""Executive pay vs performance (DEF 14A) and 5%+ holders (Schedules 13D/13G), from SEC (free, no AI).

- Pay vs performance: since 2023 proxy statements tag a standard table (ecd taxonomy): CEO pay as
  reported and as "actually paid", total shareholder return vs a peer index, net income. Read from the
  latest DEF 14A's XBRL instance.
- 5% holders: since December 2024 Schedules 13D/13G are filed as structured XML. Each one says who
  holds what percent of the class and whether they are passive (13G) or may seek influence (13D).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any

from lxml import etree

from ei.db import Db
from ei.sec import SecClient, archive_url

log = logging.getLogger(__name__)

PAY_TAGS = {
    "PeoTotalCompAmt": "ceo_reported",
    "PeoActuallyPaidCompAmt": "ceo_actually_paid",
    "NonPeoNeoAvgTotalCompAmt": "others_reported",
    "NonPeoNeoAvgCompActuallyPaidAmt": "others_actually_paid",
    "TotalShareholderRtnAmt": "tsr",
    "PeerGroupTotalShareholderRtnAmt": "peer_tsr",
    "NetIncomeLoss": "net_income",
    "CoSelectedMeasureAmt": "company_measure",
}
_PARSER = etree.XMLParser(huge_tree=True, recover=True)


def _recent(sub: dict[str, Any], forms: tuple[str, ...]) -> list[dict[str, str]]:
    r = sub.get("filings", {}).get("recent", {})
    out = []
    for i, f in enumerate(r.get("form", [])):
        if f in forms:
            out.append(
                {
                    "form": f,
                    "accession": r["accessionNumber"][i],
                    "filed": r["filingDate"][i],
                    "doc": r["primaryDocument"][i],
                }
            )
    return out


def _index(sec: SecClient, cik: int, acc: str) -> list[str]:
    idx = json.loads(sec.text(archive_url(cik, acc, "index.json")))
    return [i["name"] for i in idx["directory"]["item"]]


def parse_pay(xml: bytes) -> dict[str, Any]:
    """Pay-versus-performance rows by fiscal year from a DEF 14A instance."""
    root = etree.fromstring(xml, parser=_PARSER)
    years: dict[str, tuple[str, bool]] = {}  # context id -> (end date, has dimensions)
    for ctx in root.iter("{*}context"):
        end = ctx.find(".//{*}endDate")
        if end is None or not end.text:
            continue
        years[ctx.get("id", "")] = (end.text.strip()[:10], ctx.find(".//{*}segment") is not None)
    rows: dict[str, dict[str, Any]] = {}
    measure_name = None
    peo_names: list[str] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        name = etree.QName(el).localname
        if name == "CoSelectedMeasureName" and el.text:
            measure_name = el.text.strip()
        if name == "PeoName" and el.text and el.text.strip() not in peo_names:
            peo_names.append(el.text.strip())
        key = PAY_TAGS.get(name)
        ref = el.get("contextRef")
        if not key or not ref or ref not in years or not el.text:
            continue
        end, dims = years[ref]
        try:
            v = float(el.text.strip())
        except ValueError:
            continue
        row = rows.setdefault(end, {"year_end": end})
        if not dims or key not in row:  # the company-wide value wins over a per-person one
            row[key] = v
    return {
        "rows": sorted(rows.values(), key=lambda r: r["year_end"]),
        "measure_name": measure_name,
        "ceo_names": peo_names[:3],
    }


def _num(t: str | None) -> float | None:
    if not t:
        return None
    try:
        return float(re.sub(r"[^0-9.\-]", "", t))
    except ValueError:
        return None


def parse_13(xml: bytes) -> dict[str, Any] | None:
    """Holder, percent of class and shares from a structured Schedule 13D/13G."""
    root = etree.fromstring(xml, parser=_PARSER)
    names: list[str] = []
    pcts: list[float] = []
    shares: list[float] = []
    for el in root.iter():
        if not isinstance(el.tag, str) or not el.text or not el.text.strip():
            continue
        ln = etree.QName(el).localname.lower()
        if "reportingpersonname" in ln or ln in ("nameofreportingperson", "reportingperson"):
            names.append(el.text.strip())
        elif ("percent" in ln and "class" in ln) or ln in ("classpercent", "percentofclass"):
            v = _num(el.text)
            if v is not None and 0 <= v <= 100:
                pcts.append(v)
        elif "aggregateamount" in ln or "aggregatenumber" in ln:
            v = _num(el.text)
            if v is not None:
                shares.append(v)
    if not names or not pcts:
        return None
    return {"holder": names[0], "pct": max(pcts), "shares": max(shares) if shares else None}


def run_company(
    db: Db, sec: SecClient, cik: int, seen_pay: str | None = None, seen_13: set[str] | None = None
) -> dict[str, Any]:
    """`seen_pay` / `seen_13`: accessions already read, skipped (only new filings cost requests)."""
    sub = sec.submissions(cik)
    out: dict[str, Any] = {}
    seen_13 = seen_13 or set()
    # pay vs performance: latest proxy with tagged data
    for f in _recent(sub, ("DEF 14A",))[:2]:
        if f["accession"] == seen_pay:
            break  # latest proxy already read
        try:
            inst = next((n for n in _index(sec, cik, f["accession"]) if n.endswith("_htm.xml")), None)
            if not inst:
                continue
            pay = parse_pay(sec.text(archive_url(cik, f["accession"], inst)).encode())
            if pay["rows"]:
                db.upsert(
                    "exec_pay",
                    [
                        {
                            "cik": cik,
                            "accession": f["accession"],
                            "filed_date": f["filed"],
                            "result": pay,
                            "created_at": datetime.now().isoformat(),
                        }
                    ],
                    on_conflict="cik",
                )
                out["pay_years"] = len(pay["rows"])
                break
        except Exception as exc:
            log.info("pay %s: %s", f["accession"], exc)
    # 5% holders: structured 13D/13G filed in the last 2 years (latest per holder)
    since = (date.today() - timedelta(days=730)).isoformat()
    filings = [
        f
        for f in _recent(sub, ("SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"))
        if f["filed"] >= since
    ]
    rows = []
    for f in [x for x in filings if x["accession"] not in seen_13][:40]:
        try:
            names = _index(sec, cik, f["accession"])
            xml_name = next((n for n in names if n.lower().endswith(".xml") and "index" not in n.lower()), None)
            if not xml_name:
                continue
            p = parse_13(sec.text(archive_url(cik, f["accession"], xml_name)).encode())
            if p:
                rows.append(
                    {
                        "accession": f["accession"],
                        "cik": cik,
                        "form": f["form"],
                        "filed_date": f["filed"],
                        "holder": p["holder"],
                        "pct": p["pct"],
                        "shares": p["shares"],
                        "activist": "13D" in f["form"],
                        "url": archive_url(cik, f["accession"], f["doc"]) if f["doc"] else None,
                    }
                )
        except Exception as exc:
            log.info("13D/G %s: %s", f["accession"], exc)
    if rows:
        db.upsert("big_holders", rows, on_conflict="accession")
    out["holder_filings"] = len(rows)
    return out


def run(settings: Any, tickers: list[str] | None = None) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    sec = SecClient(settings.sec_user_agent)
    out: dict[str, Any] = {}
    try:
        pay_seen = {r["cik"]: r["accession"] for r in db.select("exec_pay", {"select": "cik,accession"})}
        held = db.select_all("big_holders", {"select": "cik,accession"})
        for c in db.select("companies", {"select": "cik,ticker"}):
            if tickers and c["ticker"] not in tickers:
                continue
            try:
                seen = {h["accession"] for h in held if h["cik"] == c["cik"]}
                out[c["ticker"]] = run_company(db, sec, c["cik"], pay_seen.get(c["cik"]), seen)
            except Exception as exc:
                out[c["ticker"]] = f"error: {exc}"[:120]
    finally:
        sec.close()
    return out
