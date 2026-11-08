"""Structure a transcript: who each speaker is, where Q&A starts, and question -> answer exchanges.

Roles come from the provider's speaker titles when present; otherwise they're inferred from the
call's own introductions ("Speaking first today is Apple's CEO, Tim Cook") and the operator's
hand-offs ("our first question comes from Erik Woodring with Morgan Stanley"). Pure code, no AI.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from ei.transcripts import Turn

ROLES = ("ceo", "cfo", "other_exec", "ir", "analyst", "operator", "unknown")
EXEC_ROLES = {"ceo", "cfo", "other_exec"}


def role_from_title(title: str, speaker: str = "") -> str | None:
    t = f" {title.lower()} "
    if "operator" in t or speaker.strip().lower() == "operator":
        return "operator"
    if "analyst" in t:
        return "analyst"
    if re.search(r"\bceo\b|chief executive", t):
        return "ceo"
    if re.search(r"\bcfo\b|chief financial|finance chief|principal financial", t):
        return "cfo"
    if "investor relations" in t or re.search(r"\bir\b", t):
        return "ir"
    if re.search(
        r"president|chief|officer|\bcoo\b|\bcto\b|vice|\bvp\b|head of|chair|director|treasurer|controller|executive|manager",
        t,
    ):
        return "other_exec"
    return None


_INTRO_PATTERNS = [
    (r"(?:chief executive officer|\bceo\b)[,]?\s+(?:is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2})", "ceo"),
    (r"([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2}),?\s+(?:our\s+)?(?:chief executive officer|\bceo\b)", "ceo"),
    (r"(?:chief financial officer|\bcfo\b)[,]?\s+(?:is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2})", "cfo"),
    (r"([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2}),?\s+(?:our\s+)?(?:chief financial officer|\bcfo\b)", "cfo"),
]
_ANALYST_HANDOFF = re.compile(
    r"(?:question|line)\s+(?:comes|is|will come)?\s*(?:from|of)\s+(?:the line of\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,2})\s+(?:with|from|of|at)\s",
    re.IGNORECASE,
)


def infer_roles(turns: list[Turn]) -> dict[str, str]:
    """speaker name -> role."""
    roles: dict[str, str] = {}
    for t in turns:
        r = role_from_title(t.title, t.speaker)
        if r and t.speaker and t.speaker not in roles:
            roles[t.speaker] = r
    # Fallback inference from the call's own words, only for speakers still unknown.
    speakers = {t.speaker for t in turns if t.speaker}
    text = " ".join(t.content for t in turns[:12])
    for pattern, role in _INTRO_PATTERNS:
        for m in re.finditer(pattern, text, flags=re.IGNORECASE):
            name = re.split(r"[,;:]|\.(?:\s|$)", m.group(1))[0].strip()
            match = next(
                (s for s in speakers if s not in roles and (s == name or s.split()[-1] == name.split()[-1])), None
            )
            if match:
                roles[match] = role
    for t in turns:
        if roles.get(t.speaker) == "operator" or t.speaker.lower() == "operator":
            for m in _ANALYST_HANDOFF.finditer(t.content):
                name = re.split(r"[,;:]|\.(?:\s|$)", m.group(1))[0].strip()
                match = next((s for s in speakers if s not in roles and s.split()[-1] == name.split()[-1]), None)
                if match:
                    roles[match] = "analyst"
    for s in speakers:
        roles.setdefault(s, "operator" if s.lower() == "operator" else "unknown")
    return roles


@dataclass
class Exchange:
    id: int
    analyst: str
    question_turns: list[int] = field(default_factory=list)
    answer_turns: list[int] = field(default_factory=list)


@dataclass
class ParsedCall:
    turns: list[dict[str, Any]]  # {i, speaker, title, role, section, words}
    speakers: dict[str, str]  # name -> role
    qa_start: int | None
    exchanges: list[Exchange]

    def to_json(self) -> dict[str, Any]:
        return {
            "turns": self.turns,
            "speakers": self.speakers,
            "qa_start": self.qa_start,
            "exchanges": [asdict(e) for e in self.exchanges],
        }


def _words(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def parse_call(turns: list[Turn]) -> ParsedCall:
    roles = infer_roles(turns)
    qa_start = next((i for i, t in enumerate(turns) if roles.get(t.speaker) == "analyst"), None)
    out_turns: list[dict[str, Any]] = [
        {
            "i": i,
            "speaker": t.speaker,
            "title": t.title,
            "role": roles.get(t.speaker, "unknown"),
            "section": "qa" if qa_start is not None and i >= qa_start else "prepared",
            "words": _words(t.content),
        }
        for i, t in enumerate(turns)
    ]

    exchanges: list[Exchange] = []
    cur: Exchange | None = None
    for row in out_turns[qa_start or len(out_turns) :]:
        role = row["role"]
        if role == "analyst":
            # A new analyst, or the same analyst asking again after being answered, opens a new exchange.
            if cur is None or cur.analyst != row["speaker"] or cur.answer_turns:
                if cur and cur.answer_turns and cur.analyst == row["speaker"]:
                    cur.question_turns.append(row["i"])  # follow-up within the same exchange
                    continue
                cur = Exchange(id=len(exchanges), analyst=row["speaker"])
                exchanges.append(cur)
            cur.question_turns.append(row["i"])
        elif role in EXEC_ROLES or (role == "unknown" and cur is not None):
            if cur is not None:
                cur.answer_turns.append(row["i"])
        elif role == "operator":
            cur = None  # operator hands to the next analyst
    exchanges = [e for e in exchanges if e.answer_turns]
    for n, e in enumerate(exchanges):
        e.id = n
    return ParsedCall(out_turns, roles, qa_start, exchanges)


def format_for_model(turns: list[Turn], parsed: ParsedCall) -> str:
    """Transcript text with stable turn ids, used in AI prompts so quotes can be traced back."""
    lines = []
    for t, row in zip(turns, parsed.turns, strict=True):
        section = "Q&A" if row["section"] == "qa" else "Prepared"
        lines.append(f"[T{row['i']}] {t.speaker} ({t.title or row['role']}) · {section}\n{t.content}")
    return "\n\n".join(lines)
