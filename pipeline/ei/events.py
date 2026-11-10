"""Company events from 8-K filings: what happened, in one line, without AI.

SEC already tags every 8-K by Item (5.02 = executive change, 1.01 = material agreement, ...). For a
readable line we take the first real sentence written under the most important Item in the filing.
Runs for new 8-Ks daily; `backfill` covers the last two years.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any

from ei.db import Db
from ei.filings.text import html_to_blocks
from ei.sec import SecClient

log = logging.getLogger(__name__)

# importance order: the first item present decides which section the summary comes from
PRIORITY = [
    "4.02",
    "1.03",
    "1.05",
    "2.04",
    "3.01",
    "5.01",
    "4.01",
    "2.06",
    "2.05",
    "2.01",
    "1.01",
    "1.02",
    "5.02",
    "2.03",
    "3.02",
    "3.03",
    "5.03",
    "8.01",
    "7.01",
    "2.02",
    "5.07",
]
SKIP_PHRASES = (
    "forward-looking",
    "is furnished",
    "shall not be deemed",
    "incorporated by reference",
    "exhibit 99",
    "see item",
)


def _clean(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip()


def summarize_8k(html: str, items: list[str]) -> str | None:
    """First substantive sentence under the most important Item, at most ~240 characters."""
    blocks = [_clean(b.text) for b in html_to_blocks(html) if _clean(b.text)]
    order = [i for i in PRIORITY if i in items] or items
    for item in order:
        head = re.compile(rf"^item\s*{re.escape(item)}\b", re.I)
        start = next((k for k, t in enumerate(blocks) if head.match(t)), None)
        if start is None:
            continue
        for t in blocks[start + 1 : start + 12]:
            if re.match(r"^item\s*\d", t, re.I):
                break
            low = t.lower()
            if len(t) < 40 or any(p in low for p in SKIP_PHRASES):
                continue
            first = re.split(r"(?<=[a-z0-9\)])\.\s+(?=[A-Z])", t)[0]
            first = first if first.endswith(".") else first + "."
            return first if len(first) <= 240 else first[:237].rsplit(" ", 1)[0] + "…"
    return None


def run(db: Db, sec: SecClient, days: int = 3, ciks: list[int] | None = None) -> dict[str, Any]:
    since = (date.today() - timedelta(days=days)).isoformat()
    params = {
        "form": "eq.8-K",
        "filed_date": f"gte.{since}",
        "summary": "is.null",
        "select": "accession,cik,url,items",
        "order": "filed_date.desc",
    }
    if ciks:
        params["cik"] = f"in.({','.join(str(c) for c in ciks)})"
    rows = db.select_all("filings", params)
    done = failed = 0
    for r in rows:
        items = [i.strip() for i in (r.get("items") or "").split(",") if i.strip() and i.strip() != "9.01"]
        try:
            text = summarize_8k(sec.text(r["url"]), items) if r.get("url") else None
        except Exception as exc:
            log.info("8-K %s unreadable: %s", r["accession"], exc)
            failed += 1
            text = None
        # an empty string marks "read, nothing usable" so it isn't fetched again
        db.update("filings", {"accession": r["accession"]}, {"summary": text or ""})
        done += 1
    return {"read": done, "failed": failed}
