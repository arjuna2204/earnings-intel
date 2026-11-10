"""Customers, suppliers and concentration from the latest 10-K (FactSet Supply Chain, from filings).

Paragraphs that mention customers, suppliers or concentration are picked in code; a small model lists
what they say, and every item must quote the filing word for word (checked in code) or it is dropped.
About a cent per company, once per 10-K.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from ei.ai import AiClient, load_prompt
from ei.db import Db
from ei.filings.release import numbered
from ei.filings.run import Fetcher
from ei.filings.text import html_to_blocks
from ei.verify import locate

log = logging.getLogger(__name__)
VERSION = "supply-v1"
_PICK = re.compile(
    r"(\bcustomers?\b[^.]{0,160}\d{1,2}(\.\d)?\s?%|\d{1,2}(\.\d)?\s?%[^.]{0,160}\bcustomers?\b|"
    r"\b(sole|single|limited number of) (source|supplier|manufacturer|foundr)|\bfoundr(y|ies)\b|"
    r"\b(contract manufacturer|supplier|manufactures? (our|its)|we (rely|depend) on)\b|concentration of credit risk)",
    re.I,
)
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["customers", "suppliers", "sole_source"],
    "properties": {
        "customers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "share_pct", "basis", "period", "quote", "para"],
                "properties": {
                    "name": {"type": "string"},
                    "share_pct": {"type": ["number", "null"]},
                    "basis": {"type": "string", "enum": ["revenue", "receivables", "other"]},
                    "period": {"type": "string"},
                    "quote": {"type": "string"},
                    "para": {"type": "integer"},
                },
            },
        },
        "suppliers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "role", "quote", "para"],
                "properties": {
                    "name": {"type": "string"},
                    "role": {"type": "string"},
                    "quote": {"type": "string"},
                    "para": {"type": "integer"},
                },
            },
        },
        "sole_source": {"type": "boolean"},
    },
}


def pick_paragraphs(paras: list[str], limit: int = 40) -> list[str]:
    out = [p for p in paras if 60 <= len(p) <= 2500 and _PICK.search(p)]
    return out[:limit]


def verify(raw: dict[str, Any], paras: list[str]) -> dict[str, Any]:
    """Keep only items whose quote is in the filing and contains the name (and the % if given)."""

    def ok(name: str, quote: str, para: int | None, pct: float | None = None) -> bool:
        idx = locate(quote, paras, para)
        if idx is None:
            return False
        q = quote.lower()
        if name.lower() not in q and name.lower() not in paras[idx].lower():
            return False
        return not (
            pct is not None
            and not re.search(rf"\b{int(pct) if float(pct).is_integer() else pct}(\.0)?\s?%", paras[idx])
        )

    customers = [c for c in raw.get("customers", []) if ok(c["name"], c["quote"], c.get("para"), c.get("share_pct"))]
    suppliers = [s for s in raw.get("suppliers", []) if ok(s["name"], s["quote"], s.get("para"))]
    return {
        "customers": [{k: c[k] for k in ("name", "share_pct", "basis", "period", "quote")} for c in customers],
        "suppliers": [{k: s[k] for k in ("name", "role", "quote")} for s in suppliers],
        "sole_source": bool(raw.get("sole_source")),
    }


def run(settings: Any, tickers: list[str] | None = None) -> dict[str, Any]:
    db = Db(settings.supabase_url, settings.supabase_secret_key)
    if not settings.anthropic_api_key:
        return {"skipped": "no AI key"}
    ai = AiClient(settings.anthropic_api_key, db)
    fetch = Fetcher(settings, db)
    have = {
        r["cik"]: r["accession"]
        for r in db.select("supply_chain", {"select": "cik,accession,version"})
        if r.get("version") == VERSION
    }
    out: dict[str, Any] = {}
    try:
        for c in db.select("companies", {"select": "cik,ticker,name"}):
            if tickers and c["ticker"] not in tickers:
                continue
            k = db.select(
                "filings",
                {
                    "cik": f"eq.{c['cik']}",
                    "form": "in.(10-K,20-F)",
                    "select": "accession,url,filed_date",
                    "order": "filed_date.desc",
                    "limit": "1",
                },
            )
            if not k or have.get(c["cik"]) == k[0]["accession"]:
                continue  # no annual report, or this one is already read
            try:
                paras = pick_paragraphs([b.text for b in html_to_blocks(fetch.html(k[0]["url"]))])
                if not paras:
                    result: dict[str, Any] = {"customers": [], "suppliers": [], "sole_source": False}
                    cost = 0.0
                else:
                    res = ai.json_call(
                        model="claude-haiku-5-5",
                        purpose="supply-chain",
                        system=load_prompt("supply_chain.v1.md"),
                        user=f"Company: {c['name']}\n\n{numbered(paras)}",
                        schema=SCHEMA,
                        max_tokens=3000,
                        cik=c["cik"],
                        effort="low",
                    )
                    result, cost = verify(res.data, paras), float(res.cost)
                db.upsert(
                    "supply_chain",
                    [
                        {
                            "cik": c["cik"],
                            "accession": k[0]["accession"],
                            "filed_date": k[0]["filed_date"],
                            "version": VERSION,
                            "result": result,
                            "created_at": datetime.now().isoformat(),
                        }
                    ],
                    on_conflict="cik",
                )
                out[c["ticker"]] = (
                    f"{len(result['customers'])} customers, {len(result['suppliers'])} suppliers, ${cost:.4f}"
                )
            except Exception as exc:
                out[c["ticker"]] = f"error: {type(exc).__name__}: {exc}"[:160]
    finally:
        fetch.close()
    return out
