"""Risk factors: split Item 1A into individual factors, match them across two years, and redline.

All deterministic code, no AI. Matching uses headline + opening text similarity (local embedding
model in production, word overlap in tests); the redline is a word-level diff.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any

from ei.embed import Embedder, greedy_match
from ei.filings.text import Block, Section

MIN_HEADLINE = 25


@dataclass
class RiskFactor:
    idx: int
    category: str
    headline: str
    body: str

    @property
    def text(self) -> str:
        return f"{self.headline}\n{self.body}".strip()


def _is_headline(b: Block) -> str | None:
    t = b.text
    if b.bold and len(t) >= MIN_HEADLINE and t.rstrip().endswith((".", "?", ";")):
        return t
    lead = b.lead_bold
    if lead and lead != t and len(lead) >= MIN_HEADLINE and lead.rstrip().endswith((".", "?", ";")):
        return lead
    return None


def _is_minor_heading(b: Block) -> bool:
    t = b.text
    return len(t) < 140 and not t.rstrip().endswith(".") and (b.bold or (t.isupper() and len(t) > 6))


def split_risk_factors(section: Section) -> list[RiskFactor]:
    blocks = section.blocks
    out: list[RiskFactor] = []
    category = ""
    cur: dict[str, Any] | None = None

    def close() -> None:
        if cur is not None:
            out.append(RiskFactor(len(out), cur["category"], cur["headline"], "\n".join(cur["body"]).strip()))

    heads = [_is_headline(b) for b in blocks]
    if sum(1 for h in heads if h) >= 3:
        for n, b in enumerate(blocks):
            h = heads[n]
            if h:
                close()
                rest = b.text[len(h) :].strip() if b.text.startswith(h) else ""
                cur = {"category": category, "headline": h, "body": [rest] if rest else []}
                continue
            if _is_minor_heading(b):
                nxt = next((heads[k] for k in range(n + 1, min(n + 3, len(blocks)))), None)
                if nxt or b.text.isupper() or cur is None:
                    category = b.text.title() if b.text.isupper() else b.text
                    continue
            if cur is not None:
                cur["body"].append(b.text)
        close()
        return out
    # Fallback for filers without emphasized headings: each substantial paragraph is a factor,
    # its first sentence used as the headline.
    for b in blocks:
        if len(b.text) < 200:
            continue
        first = re.split(r"(?<=[.!?])\s+", b.text, maxsplit=1)
        out.append(RiskFactor(len(out), "", first[0], first[1] if len(first) > 1 else ""))
    return out


# ---------------------------------------------------------------- comparison

ESCALATIONS = [
    (r"\bmay\b", r"\b(has|have|had)\b"),
    (r"\bcould\b", r"\b(did|has|have|had)\b"),
    (r"\bmight\b", r"\b(has|have|had|did)\b"),
    (r"\bpotential(ly)?\b", r"\b(actual|ongoing)\b"),
    (r"\bif\b", r"\b(as a result of|because)\b"),
]
# Added language that reports something as having happened (not just possible).
REALIZED = re.compile(
    r"\b(has|have|had)\s+(been\s+)?((adversely|materially|negatively|significantly)\s+)*"
    r"(affected|impacted|harmed|experienced|resulted|occurred|caused|increased|reduced)\b"
    r"|\b(has|have) (been|experienced),? and (may|expects? to) continue\b"
    r"|\b(has|have) (been|experienced),? and may\b"
    r"|\bexpects? [^.]{0,60}\bto (intensify|continue|worsen|increase)\b",
    re.I,
)


def _clip(t: str, n: int = 140) -> str:
    return t if len(t) <= n else t[: n - 1] + "…"


def _around(t: str, m: re.Match[str], width: int = 70) -> str:
    a, b = max(m.start() - width, 0), min(m.end() + width, len(t))
    return ("…" if a else "") + t[a:b].strip() + ("…" if b < len(t) else "")


@dataclass
class RiskChange:
    status: str  # added | removed | modified | unchanged
    new: RiskFactor | None
    old: RiskFactor | None
    similarity: float = 0.0
    redline: list[tuple[str, str]] = field(default_factory=list)  # (op, text) op in = + -
    words_added: int = 0
    words_removed: int = 0
    escalations: list[str] = field(default_factory=list)

    def as_row(self) -> dict[str, Any]:
        f = self.new or self.old
        return {
            "status": self.status,
            "similarity": round(self.similarity, 3),
            "new_idx": self.new.idx if self.new else None,
            "old_idx": self.old.idx if self.old else None,
            "headline": f.headline if f else "",
            "old_headline": self.old.headline if self.old else None,
            "category": f.category if f else "",
            "words_added": self.words_added,
            "words_removed": self.words_removed,
            "escalations": self.escalations,
            "redline": [[op, t] for op, t in self.redline],
        }


_WORD = re.compile(r"\S+")


def redline(old: str, new: str) -> tuple[list[tuple[str, str]], int, int]:
    a, b = _WORD.findall(old), _WORD.findall(new)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    ops: list[tuple[str, str]] = []
    added = removed = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            ops.append(("=", " ".join(a[i1:i2])))
        if tag in {"delete", "replace"}:
            ops.append(("-", " ".join(a[i1:i2])))
            removed += i2 - i1
        if tag in {"insert", "replace"}:
            ops.append(("+", " ".join(b[j1:j2])))
            added += j2 - j1
    return ops, added, removed


def escalation_flags(ops: list[tuple[str, str]]) -> list[str]:
    """Hedged → definite shifts: 'may' replaced by 'has', or newly added language saying a risk has
    already materialized ("has adversely affected", "have experienced, and may continue")."""
    flags: list[str] = []
    for k in range(len(ops) - 1):
        (o1, t1), (o2, t2) = ops[k], ops[k + 1]
        if o1 == "-" and o2 == "+" and len(t1) < 200:
            for soft, hard in ESCALATIONS:
                if re.search(soft, t1, re.I) and re.search(hard, t2, re.I) and not re.search(soft, t2, re.I):
                    flags.append(f"“{_clip(t1, 80)}” → “{_clip(t2, 120)}”")
                    break
    for op, t in ops:
        if op == "+":
            for m in REALIZED.finditer(t):
                if any(m.group(0) in f for f in flags):
                    continue
                flags.append(f"added: “{_around(t, m)}”")
    return flags[:6]


MATCH_THRESHOLD = 0.62  # embeddings; word overlap uses a lower bar
OVERLAP_THRESHOLD = 0.30


def _match_text(f: RiskFactor) -> str:
    return f"{f.headline} {f.body[:600]}"


def compare_risk_factors(new: list[RiskFactor], old: list[RiskFactor], embedder: Embedder) -> list[RiskChange]:
    sim = embedder.similarity_matrix([_match_text(f) for f in new], [_match_text(f) for f in old])
    threshold = MATCH_THRESHOLD if embedder.name != "word-overlap" else OVERLAP_THRESHOLD
    # Exact headline matches first (most stable signal), then similarity.
    pairs: dict[int, tuple[int, float]] = {}
    used_old: set[int] = set()
    old_by_head = {f.headline.strip().lower(): f.idx for f in old}
    for f in new:
        j = old_by_head.get(f.headline.strip().lower())
        if j is not None and j not in used_old:
            pairs[f.idx] = (j, sim[f.idx][j] if sim and sim[f.idx] else 1.0)
            used_old.add(j)
    rest_sim = [
        [(-1.0 if (i in pairs or j in used_old) else s) for j, s in enumerate(row)] for i, row in enumerate(sim)
    ]
    for i, j, s in greedy_match(rest_sim, threshold):
        pairs[i] = (j, s)
        used_old.add(j)
    changes: list[RiskChange] = []
    for f in new:
        if f.idx in pairs:
            j, s = pairs[f.idx]
            o = old[j]
            ops, added, removed = redline(o.text, f.text)
            changed = added + removed
            status = "unchanged" if changed == 0 else "modified"
            changes.append(
                RiskChange(
                    status, f, o, s, ops if changed else [], added, removed, escalation_flags(ops) if changed else []
                )
            )
        else:
            changes.append(RiskChange("added", f, None, 0.0, [("+", f.text)], len(_WORD.findall(f.text)), 0))
    for o in old:
        if o.idx not in used_old:
            changes.append(RiskChange("removed", None, o, 0.0, [("-", o.text)], 0, len(_WORD.findall(o.text))))
    order = {"added": 0, "modified": 1, "removed": 2, "unchanged": 3}
    changes.sort(key=lambda c: (order[c.status], -(len(c.escalations)), -(c.words_added + c.words_removed)))
    return changes
