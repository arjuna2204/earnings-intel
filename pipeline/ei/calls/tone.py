"""Free tone scoring with the Loughran-McDonald finance word lists (no AI cost).

For each speaker and section: share of words that are hedging ("uncertainty"), positive and
negative. Following Loughran-McDonald practice, a positive word preceded within three words by a
negation (no, not, never, ...) is not counted as positive.
"""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path
from typing import Any

from ei.calls.parse import EXEC_ROLES, ParsedCall
from ei.transcripts import Turn

DATA = Path(__file__).resolve().parents[1] / "data"
NEGATIONS = {"no", "not", "none", "neither", "never", "nobody", "nor", "cannot", "isn't", "wasn't", "don't", "doesn't"}
TOKEN = re.compile(r"[a-z]+(?:'[a-z]+)?")


@cache
def word_list(name: str) -> frozenset[str]:
    return frozenset(w.strip() for w in (DATA / f"lm_{name}.txt").read_text().splitlines() if w.strip())


def count(text: str) -> dict[str, int]:
    pos, neg, unc = word_list("positive"), word_list("negative"), word_list("uncertainty")
    toks = TOKEN.findall(text.lower())
    c = {"words": len(toks), "uncertainty": 0, "positive": 0, "negative": 0}
    for i, w in enumerate(toks):
        if w in unc:
            c["uncertainty"] += 1
        if w in neg:
            c["negative"] += 1
        if w in pos and not any(t in NEGATIONS for t in toks[max(0, i - 3) : i]):
            c["positive"] += 1
    return c


def _rates(c: dict[str, int]) -> dict[str, float | int]:
    n = c["words"] or 1
    pn = c["positive"] + c["negative"]
    return {
        "words": c["words"],
        "uncertainty_rate": c["uncertainty"] / n,
        "positive_rate": c["positive"] / n,
        "negative_rate": c["negative"] / n,
        "net_tone": (c["positive"] - c["negative"]) / pn if pn else 0.0,
        **{k: c[k] for k in ("uncertainty", "positive", "negative")},
    }


def _add(a: dict[str, int], b: dict[str, int]) -> dict[str, int]:
    return {k: a.get(k, 0) + b.get(k, 0) for k in ("words", "uncertainty", "positive", "negative")}


def score_call(turns: list[Turn], parsed: ParsedCall) -> dict[str, Any]:
    by_speaker: dict[str, dict[str, dict[str, int]]] = {}
    executives_total: dict[str, dict[str, int]] = {}
    for t, row in zip(turns, parsed.turns, strict=True):
        c = count(t.content)
        sec = row["section"]
        sp = by_speaker.setdefault(t.speaker, {})
        sp[sec] = _add(sp.get(sec, {}), c)
        sp["all"] = _add(sp.get("all", {}), c)
        if row["role"] in EXEC_ROLES:
            executives_total[sec] = _add(executives_total.get(sec, {}), c)
            executives_total["all"] = _add(executives_total.get("all", {}), c)
    return {
        "method": "Loughran-McDonald word lists (uncertainty/positive/negative), share of words",
        "speakers": {
            name: {"role": parsed.speakers.get(name, "unknown"), **{sec: _rates(c) for sec, c in secs.items()}}
            for name, secs in by_speaker.items()
        },
        "executives": {sec: _rates(c) for sec, c in executives_total.items()},
    }
