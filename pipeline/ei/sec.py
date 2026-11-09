"""SEC EDGAR client. Identifies the app via User-Agent and stays under 10 requests/second."""

from __future__ import annotations

from typing import Any

import httpx

from ei.http import RateLimiter, get_with_retries

# SEC fair-access limit is 10 req/s; stay a bit under it.
SEC_LIMITER = RateLimiter(rate=8)

TICKERS_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}/{doc}"

# Exchanges we treat as US listings. OTC is excluded for now (no reliable fundamentals/prices).
US_EXCHANGES = {"NYSE", "Nasdaq", "CBOE", "NYSE American", "NYSE Arca"}


class SecClient:
    def __init__(self, user_agent: str) -> None:
        self._client = httpx.Client(
            headers={"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"},
            timeout=60,
            follow_redirects=True,
        )

    def close(self) -> None:
        self._client.close()

    def _json(self, url: str) -> Any:
        resp = get_with_retries(self._client, url, limiter=SEC_LIMITER)
        resp.raise_for_status()
        return resp.json()

    def tickers(self) -> list[dict[str, Any]]:
        """All tickers with CIK, name and exchange, filtered to US exchanges."""
        data = self._json(TICKERS_EXCHANGE_URL)
        fields = data["fields"]
        rows = [dict(zip(fields, row, strict=True)) for row in data["data"]]
        return [
            {
                "ticker": r["ticker"].upper(),
                "cik": int(r["cik"]),
                "name": r["name"],
                "exchange": r["exchange"],
            }
            for r in rows
            if r.get("ticker") and r.get("exchange") in US_EXCHANGES
        ]

    def text(self, url: str) -> str:
        resp = get_with_retries(self._client, url, limiter=SEC_LIMITER)
        resp.raise_for_status()
        return resp.text

    def download(self, url: str, path: str) -> None:
        """Stream a large file (e.g. a 13F data-set zip) to disk."""
        SEC_LIMITER.wait()
        with self._client.stream("GET", url, timeout=600) as resp:
            resp.raise_for_status()
            with open(path, "wb") as fh:
                for chunk in resp.iter_bytes(1 << 20):
                    fh.write(chunk)

    def submissions(self, cik: int) -> dict[str, Any]:
        result: dict[str, Any] = self._json(SUBMISSIONS_URL.format(cik=cik))
        return result

    def older_submission_pages(self, submissions: dict[str, Any], since_year: int) -> list[dict[str, Any]]:
        """Extra filing-history pages (SEC splits long histories), only those overlapping our window."""
        pages = []
        for f in submissions.get("filings", {}).get("files", []):
            if f.get("filingTo", "9999")[:4] >= str(since_year):
                pages.append(self._json(f"https://data.sec.gov/submissions/{f['name']}"))
        return pages

    def companyfacts(self, cik: int) -> dict[str, Any]:
        result: dict[str, Any] = self._json(COMPANYFACTS_URL.format(cik=cik))
        return result


def archive_url(cik: int, accession: str, doc: str) -> str:
    return ARCHIVE_URL.format(cik=cik, acc_nodash=accession.replace("-", ""), doc=doc)


ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}
QUARTERLY_FORMS = {"10-Q", "10-Q/A"}
FOREIGN_FORMS = {"20-F", "40-F", "6-K"}
TRACKED_FORMS = ANNUAL_FORMS | QUARTERLY_FORMS | {"6-K", "8-K"}


def recent_filings(cik: int, submissions: dict[str, Any], since_year: int) -> list[dict[str, Any]]:
    """Flatten a filings block ('recent' in the main file, or an older page) into filings-table rows."""
    recent = submissions.get("filings", {}).get("recent", submissions)
    out: list[dict[str, Any]] = []
    for i, form in enumerate(recent.get("form", [])):
        if form not in TRACKED_FORMS:
            continue
        filed = recent["filingDate"][i]
        if int(filed[:4]) < since_year:
            continue
        acc = recent["accessionNumber"][i]
        doc = recent["primaryDocument"][i]
        out.append(
            {
                "accession": acc,
                "cik": cik,
                "form": form,
                "filed_date": filed,
                "report_date": recent["reportDate"][i] or None,
                "primary_doc": doc,
                "url": archive_url(cik, acc, doc),
                "items": (recent.get("items") or [None] * (i + 1))[i] or None,
            }
        )
    return out


def filer_type(submissions: dict[str, Any]) -> str:
    """'foreign' if the company files 20-F/40-F annual reports, else 'domestic'."""
    forms = set(submissions.get("filings", {}).get("recent", {}).get("form", []))
    if forms & {"20-F", "40-F"} and not forms & {"10-K"}:
        return "foreign"
    return "domestic"
