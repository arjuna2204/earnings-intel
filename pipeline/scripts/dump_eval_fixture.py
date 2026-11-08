"""Save real AI outputs + the exact source text they were checked against, for the regression eval.

Writes pipeline/tests/fixtures/eval/<TICKER>.json.gz with, per company:
  - releases: [{period, paragraphs, raw, kept}]   (earnings press release figures)
  - mdna:     [{period, paragraphs, raw, kept}]   (MD&A drivers)
  - briefs:   [{period_a, period_b, facts, raw, claims}]
The tests re-run the verification code on the stored raw outputs and must reproduce the stored results.
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ei.config import Settings
from ei.db import Db
from ei.filings.brief import VERSION as BRIEF_VERSION
from ei.filings.mdna import VERSION as MDNA_VERSION
from ei.filings.release import VERSION as RELEASE_VERSION

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "eval"


def dump(db: Db, ticker: str) -> dict:
    comp = db.select("companies", {"ticker": f"eq.{ticker}", "select": "cik,ticker,name"})[0]
    cik = comp["cik"]
    out: dict = {"ticker": ticker, "name": comp["name"], "releases": [], "mdna": [], "briefs": []}
    for kind, version in (("release", RELEASE_VERSION), ("mdna", MDNA_VERSION)):
        rows = db.select(
            "filing_analysis",
            {
                "cik": f"eq.{cik}",
                "kind": f"eq.{kind}",
                "version": f"eq.{version}",
                "select": "accession,period,result,raw",
            },
        )
        for r in rows:
            if kind == "release":
                sec = db.select(
                    "filing_sections",
                    {"accession": f"eq.{r['accession']}", "section": "eq.release", "select": "paragraphs"},
                )
                paras = sec[0]["paragraphs"] if sec else []
                out["releases"].append(
                    {"period": r["period"], "paragraphs": paras, "raw": r["raw"], "kept": r["result"]}
                )
            else:
                res = dict(r["result"])
                paras = res.pop("paragraphs", [])
                out["mdna"].append({"period": r["period"], "paragraphs": paras, "raw": r["raw"], "kept": res})
    for b in db.select(
        "briefs",
        {"cik": f"eq.{cik}", "version": f"eq.{BRIEF_VERSION}", "select": "period_a,period_b,inputs,raw,claims"},
    ):
        out["briefs"].append(
            {
                "period_a": b["period_a"],
                "period_b": b["period_b"],
                "facts": b["inputs"]["facts"],
                "raw": b["raw"],
                "claims": b["claims"],
            }
        )
    return out


def main(tickers: list[str]) -> None:
    s = Settings.from_env()
    db = Db(s.supabase_url, s.supabase_secret_key)
    OUT.mkdir(parents=True, exist_ok=True)
    for t in tickers:
        d = dump(db, t.upper())
        (OUT / f"{t.upper()}.json.gz").write_bytes(gzip.compress(json.dumps(d, sort_keys=True).encode()))
        print(t, {k: len(v) for k, v in d.items() if isinstance(v, list)})


if __name__ == "__main__":
    main(sys.argv[1:])
