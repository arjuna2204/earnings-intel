"""Save a company's call comparison (derived data only, no full transcript) as a golden fixture.

Used for UI checks and regression comparisons: pipeline/tests/fixtures/golden/<TICKER>_<A>_<B>.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ei.calls.extract import ANALYSIS_VERSION
from ei.config import Settings
from ei.db import Db


def main(ticker: str, a: str, b: str) -> None:
    s = Settings.from_env()
    db = Db(s.supabase_url, s.supabase_secret_key)
    comp = db.select("companies", {"ticker": f"eq.{ticker}", "select": "cik,ticker,name"})[0]
    cik = comp["cik"]
    cmp_rows = db.select(
        "call_comparisons",
        {
            "cik": f"eq.{cik}",
            "period_a": f"eq.{a}",
            "period_b": f"eq.{b}",
            "analysis_version": f"eq.{ANALYSIS_VERSION}",
            "select": "result",
        },
    )
    analyses = db.select(
        "call_analysis",
        {
            "cik": f"eq.{cik}",
            "analysis_version": f"eq.{ANALYSIS_VERSION}",
            "select": "*",
            "order": "fiscal_year.asc,fiscal_quarter.asc",
        },
    )
    for r in analyses:
        r.pop("raw_extraction", None)
    events = db.select(
        "earnings_events", {"cik": f"eq.{cik}", "select": "*", "order": "report_date.desc", "limit": "24"}
    )
    out = {
        "company": comp,
        "analysis_version": ANALYSIS_VERSION,
        "comparison": cmp_rows[0]["result"] if cmp_rows else None,
        "analyses": analyses,
        "events": events,
    }
    path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "golden" / f"{ticker}_{a}_{b}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1, default=str) + "\n")
    print("wrote", path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main(*sys.argv[1:4])
