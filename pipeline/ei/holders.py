"""Institutional holders from the SEC's Form 13F data sets (free; no AI).

Every quarter, investment managers with $100M+ file a 13F listing their US stock holdings. The SEC
publishes all of them as one zip per quarter. We read the latest two quarters and, for each loaded
company, total up who holds it and how holdings changed.

13F rows identify a stock by CUSIP and issuer name, not ticker. We match issuer names to our company
names (allowing the SEC list's abbreviations, e.g. "INTERNATIONAL BUSINESS MACHS"), then take the
CUSIP issuer prefix (first 6 characters) with the largest holdings — which covers every share class
(e.g. Alphabet A and C) — and check that total reported holdings are a plausible share of market cap.
"""

from __future__ import annotations

import csv
import io
import logging
import os
import re
import tempfile
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any

from ei.db import Db
from ei.sec import SecClient

log = logging.getLogger(__name__)
csv.field_size_limit(10**7)

DATASETS_PAGE = "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets"
SEC_BASE = "https://www.sec.gov"
TOP_N = 15

STOP = {
    "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC", "HOLDINGS", "HLDGS",
    "HOLDING", "THE", "OF", "AND", "&", "NEW", "DEL", "DE", "SA", "NV", "AG", "LP", "LLC", "SE", "CL", "COM",
    "ADR", "ADS", "SPONSORED", "SPON",
}  # fmt: skip
STATE = re.compile(r"/[A-Z]{2,3}/?|\\[A-Z]{2,3}\\")


def tokens(name: str) -> list[str]:
    s = STATE.sub(" ", name.upper())
    s = re.sub(r"[^A-Z0-9& ]", " ", s)
    toks = [t for t in s.split() if t not in STOP]
    # trailing 2-letter state codes ("WELLS FARGO CO MN")
    while len(toks) > 2 and len(toks[-1]) == 2 and toks[-1].isalpha():
        toks.pop()
    return toks


def _abbrev(short: str, full: str) -> bool:
    """`short` abbreviates `full`: same first letter and its letters appear in order (MACHS→MACHINES, MFG→MANUFACTURING)."""
    if short == full:
        return True
    if len(short) < 2 or len(full) < 2:
        return False  # single letters ("M & T") only match exactly
    if full.startswith(short):
        return True
    if short[0] != full[0] or len(short) < 3:
        return False
    it = iter(full)
    return all(ch in it for ch in short)


def names_match(issuer: str, company: str) -> bool:
    a, b = tokens(issuer), tokens(company)
    if not a or not b:
        return False
    if "".join(a) == "".join(b):
        return True  # EXXON MOBIL vs EXXONMOBIL
    if len(a) != len(b):
        return False
    if len(b) == 1:
        return a[0] == b[0]
    return all(_abbrev(x, y) for x, y in zip(a, b, strict=True))


def dataset_links(html: str) -> list[tuple[date, str]]:
    out = []
    for href in set(re.findall(r'href="([^"]*form13f\.zip)"', html, re.I)):
        m = re.search(r"(\d{2}[a-z]{3}\d{4})-(\d{2}[a-z]{3}\d{4})_form13f\.zip", href, re.I)
        if not m:
            continue
        end = datetime.strptime(m.group(2).title(), "%d%b%Y").date()
        out.append((end, href if href.startswith("http") else SEC_BASE + href))
    return sorted(out, reverse=True)


def _rows(z: zipfile.ZipFile, name: str) -> Any:
    member = next(n for n in z.namelist() if n.upper().endswith(name))
    with z.open(member) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", errors="replace"), delimiter="\t")


def _d(s: str) -> date:
    return datetime.strptime(s.strip().title(), "%d-%b-%Y").date()


def read_quarter(path: str, companies: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate one data-set zip into per-company holdings. Returns {period, by_company:{cik:{cusip6, filers:{filer_cik:{name,shares,value}}}}}."""
    with zipfile.ZipFile(path) as z:
        subs: dict[str, tuple[str, date, date]] = {}
        periods: Counter[date] = Counter()
        for r in _rows(z, "SUBMISSION.TSV"):
            if r.get("SUBMISSIONTYPE") != "13F-HR":
                continue
            p = _d(r["PERIODOFREPORT"])
            subs[r["ACCESSION_NUMBER"]] = (r["CIK"], p, _d(r["FILING_DATE"]))
            periods[p] += 1
        period = periods.most_common(1)[0][0]
        latest: dict[str, tuple[date, str]] = {}  # filer -> newest filing for the period
        for acc, (cik, p, filed) in subs.items():
            if p == period and (cik not in latest or filed > latest[cik][0]):
                latest[cik] = (filed, acc)
        keep = {acc: cik for cik, (_, acc) in latest.items()}
        managers = {
            r["ACCESSION_NUMBER"]: r.get("FILINGMANAGER_NAME", "")
            for r in _rows(z, "COVERPAGE.TSV")
            if r["ACCESSION_NUMBER"] in keep
        }

        # pass 1: which issuer (CUSIP prefix) is each company? (name match, largest value)
        name_hit: dict[str, int | None] = {}
        totals: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for r in _rows(z, "INFOTABLE.TSV"):
            if r["ACCESSION_NUMBER"] not in keep or r.get("PUTCALL") or r.get("SSHPRNAMTTYPE") != "SH":
                continue
            nm = r["NAMEOFISSUER"]
            if nm not in name_hit:
                name_hit[nm] = next((int(c["cik"]) for c in companies if names_match(nm, c["name"])), None)
            hit = name_hit[nm]
            if hit is not None:
                totals[hit][r["CUSIP"][:6].upper()] += float(r.get("VALUE") or 0)
        chosen: dict[str, int] = {}
        mcap = {int(c["cik"]): (c.get("valuation") or {}).get("market_cap") for c in companies}
        for co, by6 in totals.items():
            for c6, value in sorted(by6.items(), key=lambda kv: -kv[1])[:3]:
                cap = mcap.get(co)
                if not cap or 0.05 <= value / cap <= 2.0:  # holdings must be a plausible share of the company
                    chosen[c6] = co
                    break

        # pass 2: every holder of the chosen issuers, whatever name the filer typed
        raw: list[tuple[int, str, str, float, float]] = []  # company, accession, cusip, shares, value
        for r in _rows(z, "INFOTABLE.TSV"):
            acc = r["ACCESSION_NUMBER"]
            if acc not in keep or r.get("PUTCALL") or r.get("SSHPRNAMTTYPE") != "SH":
                continue
            co_hit = chosen.get(r["CUSIP"][:6].upper())
            if co_hit is None:
                continue
            raw.append((co_hit, acc, r["CUSIP"].upper(), float(r.get("SSHPRNAMT") or 0), float(r.get("VALUE") or 0)))

    # Filers make typos (shares in the value column, an extra digit). Every row's implied price
    # (value / shares) should be close to the quarter-end price, so drop rows far from the median.
    implied: dict[str, list[float]] = defaultdict(list)
    for _, _, cusip, sh, val in raw:
        if sh > 0 and val > 0:
            implied[cusip].append(val / sh)
    median = {k: sorted(v)[len(v) // 2] for k, v in implied.items()}
    filers: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    dropped: Counter[int] = Counter()
    for co, acc, cusip, sh, val in raw:
        m = median.get(cusip)
        if sh <= 0 or not m or not val or not 0.5 <= (val / sh) / m <= 2:
            dropped[co] += 1
            continue
        f = filers[co].setdefault(keep[acc], {"name": managers.get(acc, "").strip(), "shares": 0.0, "value": 0.0})
        f["shares"] += sh
        f["value"] += val
    return {
        "period": period,
        "by_company": {
            cik: {"cusip6": next(k for k, v in chosen.items() if v == cik), "filers": f} for cik, f in filers.items()
        },
    }


def summarize(
    cur: dict[str, dict[str, Any]], prior: dict[str, dict[str, Any]] | None, shares_out: float | None
) -> dict[str, Any]:
    prior = prior or {}
    tot = sum(f["shares"] for f in cur.values())
    ptot = sum(f["shares"] for f in prior.values()) if prior else None
    rows = []
    for fid, f in cur.items():
        before = prior.get(fid, {}).get("shares") if prior else None
        rows.append(
            {
                "filer_cik": int(fid),
                "name": f["name"],
                "shares": f["shares"],
                "value": f["value"],
                "pct_out": f["shares"] / shares_out if shares_out else None,
                "change": None if not prior else f["shares"] - (before or 0),
                "status": None
                if not prior
                else (
                    "new"
                    if before is None
                    else "added"
                    if f["shares"] > before
                    else "trimmed"
                    if f["shares"] < before
                    else "unchanged"
                ),
            }
        )
    exits = [
        {
            "filer_cik": int(fid),
            "name": f["name"],
            "shares": 0.0,
            "value": 0.0,
            "change": -f["shares"],
            "status": "sold out",
        }
        for fid, f in prior.items()
        if fid not in cur
    ]
    rows.sort(key=lambda x: -x["shares"])
    moves = [r for r in rows + exits if r["change"]]
    count = Counter(r["status"] for r in rows + exits)
    return {
        "holders": len(cur),
        "shares": tot,
        "value": sum(f["value"] for f in cur.values()),
        "pct_out": tot / shares_out if shares_out else None,
        "prior_holders": len(prior) if prior else None,
        "prior_shares": ptot,
        "shares_change_pct": (tot / ptot - 1) if ptot else None,
        "new": count["new"],
        "added": count["added"],
        "trimmed": count["trimmed"],
        "sold_out": count["sold out"],
        "top": rows[:TOP_N],
        "buyers": sorted(moves, key=lambda r: -r["change"])[:5],
        "sellers": sorted(moves, key=lambda r: r["change"])[:5],
    }


def refresh(settings: Any, force: bool = False) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    sec = SecClient(settings.sec_user_agent)
    try:
        links = dataset_links(sec.text(DATASETS_PAGE))
        if len(links) < 2:
            raise RuntimeError(f"found {len(links)} 13F data sets on {DATASETS_PAGE}")
        source = links[0][1]
        etfs = {r["sector_etf"] for r in db.select("companies", {"select": "sector_etf"}) if r.get("sector_etf")} | {
            "SPY"
        }
        companies = [
            c for c in db.select("companies", {"select": "cik,ticker,name,valuation"}) if c["ticker"] not in etfs
        ]
        done = {r["cik"]: r["source"] for r in db.select("institutional_holders", {"select": "cik,source"})}
        if not force and all(done.get(c["cik"]) == source for c in companies):
            return {"skipped": "up to date", "source": source}
        quarters = []
        with tempfile.TemporaryDirectory() as tmp:
            for _, url in links[:2]:
                path = os.path.join(tmp, url.rsplit("/", 1)[-1])
                log.info("downloading %s", url)
                sec.download(url, path)
                quarters.append(read_quarter(path, companies))
                os.remove(path)
        cur, prev = quarters
        out: dict[str, Any] = {}
        for c in companies:
            cik = int(c["cik"])
            q = cur["by_company"].get(cik)
            if not q:
                out[c["ticker"]] = "no match"
                continue
            v = c.get("valuation") or {}
            shares_out = v["market_cap"] / v["price"] if v.get("market_cap") and v.get("price") else None
            p = prev["by_company"].get(cik)
            res = summarize(q["filers"], p["filers"] if p else None, shares_out)
            res["cusip6"] = q["cusip6"]
            res["dropped_rows"] = q["dropped_rows"]
            db.upsert(
                "institutional_holders",
                [
                    {
                        "cik": cik,
                        "period": cur["period"].isoformat(),
                        "prior_period": prev["period"].isoformat() if p else None,
                        "result": res,
                        "source": source,
                    }
                ],
                on_conflict="cik",
            )
            out[c["ticker"]] = {
                "holders": res["holders"],
                "pct_out": res["pct_out"],
                "change": res["shares_change_pct"],
            }
        return {"period": cur["period"].isoformat(), "prior": prev["period"].isoformat(), "companies": out}
    finally:
        sec.close()
