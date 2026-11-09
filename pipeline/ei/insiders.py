"""Insider trades from SEC Form 4 filings (free; no AI).

For each loaded company we read the Form 4s in its EDGAR filing list for the past two years, parse the
raw XML and store every non-derivative transaction line. Only "P" (open-market purchase) and "S"
(open-market sale) are true buy/sell decisions; awards (A), option exercises (M), tax withholding (F)
and gifts (G) are stored but shown separately. Already-read filings are remembered, so daily runs
only fetch new ones.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from typing import Any

from ei.db import Db
from ei.sec import SecClient, archive_url

log = logging.getLogger(__name__)

LOOKBACK_DAYS = 730
FORMS = {"4", "4/A"}


def _t(el: ET.Element | None, path: str) -> str | None:
    if el is None:
        return None
    x = el.find(path)
    if x is None:
        return None
    v = x.find("value")
    txt = (v.text if v is not None else x.text) or ""
    return txt.strip() or None


def _f(v: str | None) -> float | None:
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def _flag(v: str | None) -> bool:
    return (v or "").strip().lower() in {"1", "true"}


def role_of(owner: ET.Element) -> str:
    rel = owner.find("reportingOwnerRelationship")
    parts = []
    if rel is not None:
        title = _t(rel, "officerTitle")
        if _flag(_t(rel, "isOfficer")):
            parts.append(title or "Officer")
        if _flag(_t(rel, "isDirector")):
            parts.append("Director")
        if _flag(_t(rel, "isTenPercentOwner")):
            parts.append("10% owner")
        if not parts and _flag(_t(rel, "isOther")):
            parts.append(_t(rel, "otherText") or "Other")
    return ", ".join(parts) or "Insider"


def parse_form4(xml: str) -> dict[str, Any]:
    """Return {issuer_cik, owners:[(name, role)], plan_10b5_1, rows:[...]} from Form 4 XML."""
    root = ET.fromstring(xml)
    issuer_cik = _t(root, "issuer/issuerCik")
    owners = [
        ((_t(o, "reportingOwnerId/rptOwnerName") or "Unknown").strip(), role_of(o))
        for o in root.findall("reportingOwner")
    ]
    # the 2023+ checkbox covers the whole form; older forms mention plans in a line's footnotes
    plan = _flag(_t(root, "aff10b5One"))
    plan_notes = {f.get("id") for f in root.iter("footnote") if re.search(r"10b5-?1", f.text or "", re.I)}
    rows = []
    for tx in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        code = _t(tx, "transactionCoding/transactionCode")
        if not code:
            continue
        shares = _f(_t(tx, "transactionAmounts/transactionShares"))
        price = _f(_t(tx, "transactionAmounts/transactionPricePerShare"))
        ad = _t(tx, "transactionAmounts/transactionAcquiredDisposedCode")
        # a transaction-level footnote can mark just this line as a 10b5-1 plan sale
        tx_notes = {fid.get("id") for fid in tx.iter("footnoteId")}
        tx_plan = plan or bool(tx_notes & plan_notes)
        rows.append(
            {
                "trade_date": _t(tx, "transactionDate"),
                "code": code,
                "acquired": None if ad is None else ad == "A",
                "shares": shares,
                "price": price,
                "value": round(shares * price, 2) if shares is not None and price else None,
                "owned_after": _f(_t(tx, "postTransactionAmounts/sharesOwnedFollowingTransaction")),
                "direct": None
                if _t(tx, "ownershipNature/directOrIndirectOwnership") is None
                else _t(tx, "ownershipNature/directOrIndirectOwnership") == "D",
                "plan_10b5_1": bool(tx_plan),
            }
        )
    return {
        "issuer_cik": int(issuer_cik) if issuer_cik and issuer_cik.isdigit() else None,
        "owners": owners,
        "rows": rows,
    }


def form4_list(sub: dict[str, Any], since: date) -> list[dict[str, str]]:
    r = sub.get("filings", {}).get("recent", {})
    out = []
    for form, acc, filed, doc in zip(
        r.get("form", []),
        r.get("accessionNumber", []),
        r.get("filingDate", []),
        r.get("primaryDocument", []),
        strict=False,
    ):
        if form in FORMS and filed >= since.isoformat() and doc:
            # primaryDocument is the rendered view (xslF345X0N/x.xml); the raw XML has the same name without the folder
            out.append({"accession": acc, "filed": filed, "doc": doc.split("/")[-1], "view": doc})
    return out


def run_company(db: Db, sec: SecClient, company: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    cik = int(company["cik"])
    filings = form4_list(sec.submissions(cik), today - timedelta(days=LOOKBACK_DAYS))
    if not filings:
        return {"filings": 0, "new": 0}
    seen: set[str] = set()
    accs = [f["accession"] for f in filings]
    for i in range(0, len(accs), 150):
        chunk = ",".join(f'"{a}"' for a in accs[i : i + 150])
        seen |= {
            r["accession"]
            for r in db.select("insider_filings_seen", {"accession": f"in.({chunk})", "select": "accession"})
        }
    new = [f for f in filings if f["accession"] not in seen]
    rows: list[dict[str, Any]] = []
    done: list[dict[str, Any]] = []
    for f in new:
        url = archive_url(cik, f["accession"], f["doc"])
        try:
            parsed = parse_form4(sec.text(url))
        except Exception as e:  # malformed or missing XML: remember and move on
            log.warning("form4 %s: %s", f["accession"], e)
            done.append({"accession": f["accession"], "cik": cik})
            continue
        if parsed["issuer_cik"] not in (None, cik):
            done.append({"accession": f["accession"], "cik": cik})
            continue
        name = " & ".join(o[0] for o in parsed["owners"][:2]) or "Unknown"
        role = parsed["owners"][0][1] if parsed["owners"] else None
        view = archive_url(cik, f["accession"], f["view"])
        for i, r in enumerate(parsed["rows"]):
            rows.append(
                {
                    "accession": f["accession"],
                    "seq": i,
                    "cik": cik,
                    "filed_date": f["filed"],
                    "owner": name,
                    "role": role,
                    "url": view,
                    **r,
                }
            )
        done.append({"accession": f["accession"], "cik": cik})
        if len(done) % 50 == 0:  # save progress in batches
            db.upsert("insider_trades", rows, on_conflict="accession,seq") if rows else None
            db.upsert("insider_filings_seen", done[-50:], on_conflict="accession")
            rows = []
    if rows:
        db.upsert("insider_trades", rows, on_conflict="accession,seq")
    rest = done[(len(done) // 50) * 50 :]
    if rest:
        db.upsert("insider_filings_seen", rest, on_conflict="accession")
    return {"filings": len(filings), "new": len(new)}


def run_all(settings: Any, tickers: list[str] | None = None) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    sec = SecClient(settings.sec_user_agent)
    etfs = {r["sector_etf"] for r in db.select("companies", {"select": "sector_etf"}) if r.get("sector_etf")} | {"SPY"}
    out: dict[str, Any] = {}
    try:
        for c in db.select("companies", {"select": "cik,ticker"}):
            if c["ticker"] in etfs or (tickers and c["ticker"] not in tickers):
                continue
            try:
                out[c["ticker"]] = run_company(db, sec, c)
            except Exception as e:
                out[c["ticker"]] = {"error": f"{type(e).__name__}: {e}"[:200]}
    finally:
        sec.close()
    return out
