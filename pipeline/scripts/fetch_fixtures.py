"""Download companyfacts for the test companies, trimmed to the tags our mapping uses.

Run in GitHub Actions (needs SEC_USER_AGENT). Writes pipeline/tests/fixtures/<TICKER>.json.gz
plus a small <TICKER>.meta.json with SIC and fiscal year end from the submissions file.
"""

from __future__ import annotations

import gzip
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ei.sec import SecClient
from ei.xbrl.mapping import DEI_SHARES_TAG, REPORTED

COMPANIES = {"AAPL": 320193, "MSFT": 789019, "JPM": 19617, "WMT": 104169, "XOM": 34088, "O": 726728, "TSM": 1046179}
OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def main() -> int:
    keep = {("us-gaap", t) for m in REPORTED for t in m.us_gaap} | {("ifrs-full", t) for m in REPORTED for t in m.ifrs}
    keep.add(("dei", DEI_SHARES_TAG))
    sec = SecClient(os.environ["SEC_USER_AGENT"])
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        for ticker, cik in COMPANIES.items():
            facts = sec.companyfacts(cik)
            trimmed = {
                "cik": facts.get("cik"),
                "entityName": facts.get("entityName"),
                "facts": {
                    tax: {tag: node for tag, node in tags.items() if (tax, tag) in keep}
                    for tax, tags in facts.get("facts", {}).items()
                },
            }
            with gzip.open(OUT / f"{ticker}.json.gz", "wt", encoding="utf-8") as f:
                json.dump(trimmed, f, separators=(",", ":"))
            subs = sec.submissions(cik)
            meta = {
                "cik": cik,
                "sic": subs.get("sic"),
                "fiscalYearEnd": subs.get("fiscalYearEnd"),
                "name": subs.get("name"),
            }
            (OUT / f"{ticker}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
            print(ticker, "ok", (OUT / f"{ticker}.json.gz").stat().st_size, "bytes")
    finally:
        sec.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
