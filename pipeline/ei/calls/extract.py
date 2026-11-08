"""AI extraction from one earnings call (Haiku 5.5), validated with Pydantic and quote-verified.

Every item must carry a quote that appears verbatim in the cited turn (or, failing that, in some
turn — then the turn number is corrected). Anything that fails verification is dropped and logged.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ei.ai import HAIKU, AiClient, load_prompt
from ei.calls.parse import ParsedCall, format_for_model
from ei.transcripts import Turn
from ei.verify import locate

PROMPT_FILE = "call_extraction.v2.md"
ANALYSIS_VERSION = "calls-v4"  # bump when prompts or parsing change: cached analyses then re-run


class Quoted(BaseModel):
    quote: str
    turn: int


class Guidance(Quoted):
    metric: str
    period: str
    low: float | None = None
    high: float | None = None
    point: float | None = None
    unit: str | None = None
    qualitative: str | None = None
    withdrawn: bool = False


class Kpi(Quoted):
    name: str
    value: float | None = None
    unit: str | None = None
    period: str | None = None


class Risk(Quoted):
    label: str
    summary: str


class Topic(Quoted):
    label: str
    summary: str
    turns: list[int] = Field(default_factory=list)


class QaScore(BaseModel):
    exchange: int
    evasiveness: float = Field(ge=0, le=1)
    reason: str


class Extraction(BaseModel):
    guidance: list[Guidance] = Field(default_factory=list)
    kpis: list[Kpi] = Field(default_factory=list)
    risks: list[Risk] = Field(default_factory=list)
    topics: list[Topic] = Field(default_factory=list)
    qa_scores: list[QaScore] = Field(default_factory=list)


def _obj(props: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or list(props), "additionalProperties": False}


_S = {"type": "string"}
_I = {"type": "integer"}
_NUM = {"type": ["number", "null"]}
_NSTR = {"type": ["string", "null"]}

SCHEMA: dict[str, Any] = _obj(
    {
        "guidance": {
            "type": "array",
            "items": _obj(
                {
                    "metric": _S,
                    "period": _S,
                    "low": _NUM,
                    "high": _NUM,
                    "point": _NUM,
                    "unit": _NSTR,
                    "qualitative": _NSTR,
                    "withdrawn": {"type": "boolean"},
                    "quote": _S,
                    "turn": _I,
                }
            ),
        },
        "kpis": {
            "type": "array",
            "items": _obj({"name": _S, "value": _NUM, "unit": _NSTR, "period": _NSTR, "quote": _S, "turn": _I}),
        },
        "risks": {"type": "array", "items": _obj({"label": _S, "summary": _S, "quote": _S, "turn": _I})},
        "topics": {
            "type": "array",
            "items": _obj(
                {"label": _S, "summary": _S, "quote": _S, "turn": _I, "turns": {"type": "array", "items": _I}}
            ),
        },
        "qa_scores": {
            "type": "array",
            "items": _obj({"exchange": _I, "evasiveness": {"type": "number"}, "reason": _S}),
        },
    }
)


def exchanges_text(turns: list[Turn], parsed: ParsedCall) -> str:
    lines = []
    for e in parsed.exchanges:
        q = ", ".join(f"T{i}" for i in e.question_turns)
        a = ", ".join(f"T{i}" for i in e.answer_turns)
        lines.append(f"E{e.id}: analyst {e.analyst}; question turns {q}; answer turns {a}")
    return "\n".join(lines) or "(no Q&A exchanges detected)"


def build_user_message(company: str, period: str, turns: list[Turn], parsed: ParsedCall) -> str:
    return (
        f"COMPANY: {company}\nCALL: {period}\n\nEXCHANGES (score each one in qa_scores; use the number after E):\n"
        f"{exchanges_text(turns, parsed)}\n\nTRANSCRIPT:\n{format_for_model(turns, parsed)}"
    )


def _number_in_text(x: float, text: str) -> bool:
    """True if the number appears in the text as written (14 / 14.0 / 1,234 / 18.1)."""
    nums = {float(m.replace(",", "")) for m in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}
    return any(abs(n - x) < 1e-9 for n in nums)


def check_guidance_numbers(item: dict[str, Any]) -> dict[str, Any]:
    """Guidance numbers must be stated in the quote itself. Numbers the model inferred from context
    are removed (the item stays, as qualitative, with its exact quote)."""
    fields = [f for f in ("low", "high", "point") if item.get(f) is not None]
    if fields and not all(_number_in_text(float(item[f]), item["quote"]) for f in fields):
        item = {**item, "qualitative": item.get("qualitative") or item["quote"], "numbers_removed": True}
        for f in fields:
            item[f] = None
    return item


def _sentences(text: str) -> list[str]:
    return [x.strip() for x in re.split(r"(?<=[.!?])\s+", text) if len(x.split()) >= 6]


def pick_topic_quote(label: str, turn_ids: list[int], sources: list[str]) -> tuple[int, str] | None:
    """A verbatim sentence from the topic's own turns, preferring one that shares words with the label."""
    words = {w for w in re.findall(r"[a-z]+", label.lower()) if len(w) > 3}
    best: tuple[int, int, str] | None = None
    for t in turn_ids:
        for sent in _sentences(sources[t]):
            score = sum(w in sent.lower() for w in words)
            cand = (score, t, " ".join(sent.split()[:40]))
            if best is None or cand[0] > best[0]:
                best = cand
    if best is None:
        return None
    return best[1], best[2]


def verify_extraction(
    ex: Extraction, turns: list[Turn], parsed: ParsedCall
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Keep only items whose quote is verbatim in the transcript; fix turn numbers; log the rest."""
    sources = [t.content for t in turns]
    kept: dict[str, Any] = {"guidance": [], "kpis": [], "risks": [], "topics": []}
    dropped: list[dict[str, Any]] = []
    for kind in ("guidance", "kpis", "risks", "topics"):
        for item in getattr(ex, kind):
            where = locate(item.quote, sources, item.turn)
            d = item.model_dump()
            if where is None and kind == "topics":
                # The topic itself is grounded in the turns where it was discussed; if the model's
                # sample quote was paraphrased, pick a real sentence from those turns instead.
                picked = pick_topic_quote(item.label, [t for t in item.turns if 0 <= t < len(turns)], sources)
                if picked:
                    where, d["quote"] = picked
                    d["quote_selected_by_code"] = True
                    dropped.append(
                        {"kind": kind, "item": item.model_dump(), "reason": "quote replaced: model paraphrased"}
                    )
            if where is None:
                dropped.append({"kind": kind, "item": item.model_dump(), "reason": "quote not found verbatim"})
                continue
            if kind == "guidance":
                d = check_guidance_numbers(d)
            d["turn"] = where
            d["speaker"] = turns[where].speaker
            d["role"] = parsed.turns[where]["role"]
            d["section"] = parsed.turns[where]["section"]
            if kind == "topics":
                d["turns"] = sorted({t for t in item.turns if 0 <= t < len(turns)} | {where})
            kept[kind].append(d)
    return kept, dropped


def evasiveness_rows(ex: Extraction, parsed: ParsedCall) -> list[dict[str, Any]]:
    by_id = {e.id: e for e in parsed.exchanges}
    out = []
    for s in ex.qa_scores:
        e = by_id.get(s.exchange)
        if e is None:
            continue
        out.append(
            {
                "exchange": e.id,
                "analyst": e.analyst,
                "question_turns": e.question_turns,
                "answer_turns": e.answer_turns,
                "evasiveness": round(s.evasiveness, 2),
                "reason": s.reason,
            }
        )
    return sorted(out, key=lambda r: r["exchange"])


def extract_call(
    ai: AiClient, company: str, period: str, turns: list[Turn], parsed: ParsedCall, cik: int
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], float, dict[str, Any]]:
    """Returns (verified extraction, evasiveness rows, dropped claims, cost in USD, raw model output)."""
    result = ai.json_call(
        model=HAIKU,
        purpose=f"call extraction {period}",
        system=load_prompt(PROMPT_FILE),
        user=build_user_message(company, period, turns, parsed),
        schema=SCHEMA,
        max_tokens=12000,
        cik=cik,
        effort="medium",
    )
    try:
        ex = Extraction.model_validate(result.data)
    except ValidationError as exc:
        raise RuntimeError(f"Extraction failed validation: {exc.errors()[:3]}") from exc
    kept, dropped = verify_extraction(ex, turns, parsed)
    return kept, evasiveness_rows(ex, parsed), dropped, float(result.cost), result.data
