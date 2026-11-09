"""Diagnostics for the 13F reader: what the raw data set says about one company."""

from __future__ import annotations

import os
import tempfile
from collections import Counter, defaultdict
from typing import Any

from ei.db import Db
from ei.holders import DATASETS_PAGE, _rows, dataset_links, names_match
from ei.sec import SecClient


def debug(settings: Any, ticker: str) -> dict[str, Any]:
    import zipfile

    db = Db(settings.supabase_url, settings.supabase_secret_key)
    c = db.select("companies", {"ticker": f"eq.{ticker}", "select": "cik,name,valuation"})[0]
    sec = SecClient(settings.sec_user_agent)
    url = dataset_links(sec.text(DATASETS_PAGE))[0][1]
    out: dict[str, Any] = {"url": url}
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "q.zip")
        sec.download(url, path)
        with zipfile.ZipFile(path) as z:
            out["members"] = z.namelist()
            types: Counter[str] = Counter()
            periods: Counter[str] = Counter()
            sub = {}
            for r in _rows(z, "SUBMISSION.TSV"):
                types[r.get("SUBMISSIONTYPE", "")] += 1
                periods[r.get("PERIODOFREPORT", "")] += 1
                sub[r["ACCESSION_NUMBER"]] = r
            out["types"] = types.most_common(8)
            out["periods"] = periods.most_common(5)
            out["submission_cols"] = list(next(iter(sub.values())).keys())
            rows = 0
            by9: defaultdict[str, float] = defaultdict(float)
            names: Counter[str] = Counter()
            per_acc: dict[str, float] = defaultdict(float)
            cols: list[str] = []
            sample: list[dict[str, str]] = []
            for r in _rows(z, "INFOTABLE.TSV"):
                if not cols:
                    cols = list(r.keys())
                if names_match(r["NAMEOFISSUER"], c["name"]) and not r.get("PUTCALL"):
                    rows += 1
                    sh = float(r.get("SSHPRNAMT") or 0)
                    by9[r["CUSIP"]] += sh
                    names[r["NAMEOFISSUER"]] += 1
                    per_acc[r["ACCESSION_NUMBER"]] += sh
                    if len(sample) < 3:
                        sample.append(r)
            out["infotable_cols"] = cols
            out["rows"] = rows
            out["by_cusip"] = sorted(by9.items(), key=lambda kv: -kv[1])[:5]
            out["names"] = names.most_common(5)
            v = c.get("valuation") or {}
            out["shares_out"] = v["market_cap"] / v["price"] if v.get("market_cap") and v.get("price") else None
            top = sorted(per_acc.items(), key=lambda kv: -kv[1])[:12]
            out["top_accessions"] = [
                {
                    "acc": a,
                    "shares": s,
                    "cik": sub.get(a, {}).get("CIK"),
                    "type": sub.get(a, {}).get("SUBMISSIONTYPE"),
                    "period": sub.get(a, {}).get("PERIODOFREPORT"),
                    "filed": sub.get(a, {}).get("FILING_DATE"),
                }
                for a, s in top
            ]
            out["sample"] = sample
    sec.close()
    return out
