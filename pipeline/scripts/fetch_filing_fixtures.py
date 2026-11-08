"""Download real filing documents (HTML, gzipped) for parser tests.

Writes pipeline/tests/fixtures/filings/<TICKER>_<FORM>_<REPORTDATE>.htm.gz and an index.json.
"""

from __future__ import annotations

import gzip
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ei.http import get_with_retries
from ei.sec import SEC_LIMITER, SecClient, archive_url

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "filings"
WANT = {"AAPL": (320193, 2, 1), "MSFT": (789019, 2, 1), "NVDA": (1045810, 0, 1)}  # (cik, 10-Ks, earnings 8-Ks)


def main() -> None:
    sec = SecClient(os.environ["SEC_USER_AGENT"])
    client = sec._client
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    try:
        for ticker, (cik, n_10k, n_8k) in WANT.items():
            r = sec.submissions(cik)["filings"]["recent"]
            rows = [
                {
                    k: r[k][i]
                    for k in ("form", "accessionNumber", "primaryDocument", "reportDate", "filingDate", "items")
                }
                for i in range(len(r["form"]))
            ]
            tenks = [x for x in rows if x["form"] == "10-K"][:n_10k]
            eights = [x for x in rows if x["form"] == "8-K" and "2.02" in (x.get("items") or "")][:n_8k]
            for x in tenks:
                url = archive_url(cik, x["accessionNumber"], x["primaryDocument"])
                html = get_with_retries(client, url, limiter=SEC_LIMITER).text
                name = f"{ticker}_10-K_{x['reportDate']}.htm.gz"
                (OUT / name).write_bytes(gzip.compress(html.encode("utf-8")))
                index.append({"ticker": ticker, "cik": cik, "form": "10-K", "file": name, "url": url, **x})
            for x in eights:
                acc = x["accessionNumber"]
                base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
                files = get_with_retries(client, f"{base}/index.json", limiter=SEC_LIMITER).json()["directory"]["item"]
                ex = [
                    f["name"]
                    for f in files
                    if f["name"].lower().endswith((".htm", ".html")) and ("99" in f["name"].lower())
                ]
                if not ex:
                    continue
                url = f"{base}/{ex[0]}"
                html = get_with_retries(client, url, limiter=SEC_LIMITER).text
                name = f"{ticker}_8-K-EX99_{x['filingDate']}.htm.gz"
                (OUT / name).write_bytes(gzip.compress(html.encode("utf-8")))
                index.append({"ticker": ticker, "cik": cik, "form": "8-K EX-99", "file": name, "url": url, **x})
        (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n")
        for i in index:
            print(i["file"], (OUT / i["file"]).stat().st_size)
    finally:
        sec.close()


if __name__ == "__main__":
    main()
