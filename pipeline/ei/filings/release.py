"""Company-reported Street figures from the quarterly earnings press release (8-K Exhibit 99.1).

Haiku reads the release and returns figures with verbatim quotes. Code then verifies every quote is
in the release and every number is in its quote; anything failing is dropped. No arithmetic by AI.
"""

from __future__ import annotations

from typing import Any

from ei.ai import AiClient, load_prompt
from ei.calls.extract import _stated
from ei.filings.text import Block
from ei.verify import locate

PROMPT_FILE = "earnings_release.v1.md"
VERSION = "release-v1"
MODEL = "claude-haiku-5-5"

KINDS = [
    "eps_gaap",
    "eps_adjusted",
    "net_income_gaap",
    "net_income_adjusted",
    "revenue",
    "gross_margin_gaap",
    "gross_margin_adjusted",
    "operating_income_gaap",
    "operating_income_adjusted",
    "operating_margin_gaap",
    "operating_margin_adjusted",
    "ebitda_adjusted",
    "free_cash_flow",
    "ffo",
    "affo",
    "core_eps",
    "other",
]
_NUM = {"type": ["number", "null"]}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reports_non_gaap", "non_gaap_definition", "figures", "adjustments"],
    "properties": {
        "reports_non_gaap": {"type": "boolean"},
        "non_gaap_definition": {"type": ["string", "null"]},
        "figures": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "label", "current", "prior", "unit", "scale", "basis", "quote", "para"],
                "properties": {
                    "kind": {"type": "string", "enum": KINDS},
                    "label": {"type": "string"},
                    "current": _NUM,
                    "prior": _NUM,
                    "unit": {"type": "string", "enum": ["USD", "USD per share", "percent"]},
                    "scale": {"type": "string", "enum": ["units", "thousands", "millions", "billions"]},
                    "basis": {"type": "string", "enum": ["quarter", "full year"]},
                    "quote": {"type": "string"},
                    "para": {"type": "integer"},
                },
            },
        },
        "adjustments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "current", "applies_to", "scale", "quote", "para"],
                "properties": {
                    "label": {"type": "string"},
                    "current": _NUM,
                    "applies_to": {"type": "string"},
                    "scale": {"type": "string", "enum": ["units", "thousands", "millions", "billions"]},
                    "quote": {"type": "string"},
                    "para": {"type": "integer"},
                },
            },
        },
    },
}
SCALE = {"units": 1.0, "thousands": 1e3, "millions": 1e6, "billions": 1e9}


def paragraphs(blocks: list[Block]) -> list[str]:
    return [b.text for b in blocks]


def numbered(paras: list[str]) -> str:
    return "\n".join(f"[P{i}] {t}" for i, t in enumerate(paras))


def _num_ok(x: float | None, quote: str) -> bool:
    if x is None:
        return True
    # "(207)" means -207: accept the absolute value printed in parentheses.
    return _stated(x, quote) or _stated(abs(x), quote)


def verify_release(data: dict[str, Any], paras: list[str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Keep figures whose quote is verbatim in the release and whose numbers are in the quote."""
    dropped: list[dict[str, Any]] = []
    figs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for f in data.get("figures", []):
        idx = locate(f["quote"], paras, f.get("para"))
        if idx is None:
            dropped.append({**f, "reason": "quote not found in release"})
            continue
        f = {**f, "para": idx}
        if f.get("prior") is not None and not _num_ok(f["prior"], f["quote"]):
            f["prior"] = None
        if f.get("current") is None or not _num_ok(f["current"], f["quote"]):
            dropped.append({**f, "reason": "number not in quote"})
            continue
        if f["kind"] != "other" and f["kind"] in seen:
            continue
        seen.add(f["kind"])
        f["value"] = f["current"] * (SCALE[f["scale"]] if f["unit"] == "USD" else 1.0)
        f["prior_value"] = (
            f["prior"] * (SCALE[f["scale"]] if f["unit"] == "USD" else 1.0) if f.get("prior") is not None else None
        )
        figs.append(f)
    adjs: list[dict[str, Any]] = []
    for a in data.get("adjustments", []):
        idx = locate(a["quote"], paras, a.get("para"))
        if idx is None or not _num_ok(a.get("current"), a["quote"]):
            dropped.append({**a, "reason": "adjustment quote/number not verified"})
            continue
        adjs.append({**a, "para": idx})
    definition = data.get("non_gaap_definition")
    if definition and locate(definition, paras) is None:
        definition = None
    kept = {
        "reports_non_gaap": bool(data.get("reports_non_gaap"))
        and any(
            f["kind"].endswith("_adjusted") or f["kind"] in {"core_eps", "ffo", "affo", "ebitda_adjusted"} for f in figs
        ),
        "non_gaap_definition": definition,
        "figures": figs,
        "adjustments": adjs,
    }
    return kept, dropped


def extract_release(ai: AiClient, paras: list[str], company: str, period: str, cik: int) -> dict[str, Any]:
    system = load_prompt(PROMPT_FILE)
    user = f"Company: {company}\nQuarter: {period}\n\nEARNINGS RELEASE\n{numbered(paras)}"
    res = ai.json_call(
        model=MODEL,
        purpose=f"release:{period}",
        system=system,
        user=user,
        schema=SCHEMA,
        max_tokens=6000,
        cik=cik,
        effort="low",
    )
    raw = res.data
    kept, dropped = verify_release(raw, paras)
    return {"kept": kept, "dropped": dropped, "raw": raw, "cost_usd": float(res.cost)}
