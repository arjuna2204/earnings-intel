"""MD&A drivers, capital use, outlook, and named competitors from a periodic report (Haiku, verified quotes)."""

from __future__ import annotations

import re
from typing import Any

from ei.ai import AiClient, load_prompt
from ei.filings.release import numbered
from ei.verify import locate

PROMPT_FILE = "filing_extraction.v1.md"
VERSION = "mdna-v1"
MODEL = "claude-haiku-5-5"
MAX_CHARS = 120_000  # ~30K tokens; keeps the call in the cheap price tier

_Q = {"quote": {"type": "string"}, "para": {"type": "integer"}}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["drivers", "capital", "competitors", "outlook"],
    "properties": {
        "drivers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["metric", "direction", "change_text", "driver", "offset", "quote", "para"],
                "properties": {
                    "metric": {"type": "string"},
                    "direction": {"type": "string", "enum": ["up", "down", "flat", "mixed"]},
                    "change_text": {"type": ["string", "null"]},
                    "driver": {"type": "string"},
                    "offset": {"type": "boolean"},
                    **_Q,
                },
            },
        },
        "capital": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "summary", "quote", "para"],
                "properties": {"label": {"type": "string"}, "summary": {"type": "string"}, **_Q},
            },
        },
        "competitors": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "quote", "para"],
                "properties": {"name": {"type": "string"}, **_Q},
            },
        },
        "outlook": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["metric", "statement", "quote", "para"],
                "properties": {"metric": {"type": "string"}, "statement": {"type": "string"}, **_Q},
            },
        },
    },
}

_COMPETE = re.compile(r"\bcompet", re.I)


def build_input(mdna: list[str], business: list[str]) -> tuple[list[str], str]:
    """Paragraph list the model sees (MD&A first, then Business paragraphs about competition)."""
    paras = list(mdna)
    comp = [p for p in business if _COMPETE.search(p)][:25]
    text_parts = ["MD&A"]
    paras_all = paras + comp
    # Trim from the end of MD&A if very long (tables at the end matter least).
    total = 0
    keep = 0
    for p in paras_all:
        total += len(p) + 8
        if total > MAX_CHARS:
            break
        keep += 1
    paras_all = paras_all[:keep]
    body = numbered(paras_all)
    if comp:
        first_comp = len(paras)
        body = body.replace(f"[P{first_comp}] ", f"\nBUSINESS SECTION — COMPETITION\n[P{first_comp}] ", 1)
    return paras_all, text_parts[0] + "\n" + body


def verify_mdna(data: dict[str, Any], paras: list[str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    kept: dict[str, Any] = {}
    dropped: list[dict[str, Any]] = []
    for key in ("drivers", "capital", "competitors", "outlook"):
        out = []
        for item in data.get(key, []):
            idx = locate(item["quote"], paras, item.get("para"))
            if idx is None:
                dropped.append({**item, "section": key, "reason": "quote not found"})
                continue
            if key == "competitors" and item["name"].lower() not in paras[idx].lower():
                dropped.append({**item, "section": key, "reason": "name not in paragraph"})
                continue
            out.append({**item, "para": idx})
        kept[key] = out
    uniq: dict[str, dict[str, Any]] = {}
    for c in kept["competitors"]:
        uniq.setdefault(c["name"].lower(), c)
    kept["competitors"] = list(uniq.values())
    return kept, dropped


def extract_mdna(
    ai: AiClient, mdna: list[str], business: list[str], company: str, period: str, cik: int
) -> dict[str, Any]:
    paras, body = build_input(mdna, business)
    res = ai.json_call(
        model=MODEL,
        purpose=f"mdna:{period}",
        system=load_prompt(PROMPT_FILE),
        user=f"Company: {company}\nPeriod: {period}\n\n{body}",
        schema=SCHEMA,
        max_tokens=10000,
        cik=cik,
        effort="low",
    )
    kept, dropped = verify_mdna(res.data, paras)
    return {"kept": kept, "dropped": dropped, "raw": res.data, "paragraphs": paras, "cost_usd": float(res.cost)}
