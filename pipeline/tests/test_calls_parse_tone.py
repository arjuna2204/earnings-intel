from __future__ import annotations

import pytest

from ei.calls.parse import infer_roles, parse_call, role_from_title
from ei.calls.tone import count, score_call
from ei.transcripts import Turn

CALL = [
    Turn("Operator", "Operator", "Good day, and welcome to the Q1 call. I'll turn it over to Jane Roe."),
    Turn(
        "Jane Roe",
        "Director of Investor Relations",
        "Speaking first today is our CEO, Tim Cook, followed by CFO, Luca Maestri.",
    ),
    Turn("Tim Cook", "CEO", "We had a record quarter. Demand was strong and we are pleased with growth."),
    Turn(
        "Luca Maestri",
        "CFO",
        "We expect revenue to grow low single digits. Results may vary due to uncertain conditions.",
    ),
    Turn("Operator", "Operator", "Our first question comes from Erik Woodring with Morgan Stanley."),
    Turn("Erik Woodring", "Analyst", "Can you talk about gross margin?"),
    Turn("Luca Maestri", "CFO", "We expect gross margin between 46% and 47%."),
    Turn("Erik Woodring", "Analyst", "And a follow-up on China?"),
    Turn("Tim Cook", "CEO", "We don't break that out, but we feel good about the long term."),
    Turn("Operator", "Operator", "Next question comes from Amit Daryanani with Evercore."),
    Turn("Amit Daryanani", "Analyst", "On services, is growth sustainable?"),
    Turn("Tim Cook", "CEO", "Yes, it is not a problem. We remain confident."),
]


@pytest.mark.parametrize(
    ("title", "role"),
    [
        ("CEO", "ceo"),
        ("Chief Executive Officer & Director", "ceo"),
        ("Senior Vice President & CFO", "cfo"),
        ("Executive VP & Chief Financial Officer", "cfo"),
        ("Director of Investor Relations", "ir"),
        ("Analyst", "analyst"),
        ("Operator", "operator"),
        ("President, Cloud", "other_exec"),
        ("", None),
    ],
)
def test_role_from_title(title: str, role: str | None) -> None:
    assert role_from_title(title) == role


def test_roles_inferred_when_titles_missing() -> None:
    untitled = [Turn(t.speaker, "" if t.speaker != "Operator" else "Operator", t.content) for t in CALL]
    roles = infer_roles(untitled)
    assert roles["Tim Cook"] == "ceo"
    assert roles["Luca Maestri"] == "cfo"
    assert roles["Erik Woodring"] == "analyst"
    assert roles["Amit Daryanani"] == "analyst"


def test_sections_and_exchanges() -> None:
    p = parse_call(CALL)
    assert p.qa_start == 5
    assert [r["section"] for r in p.turns[:5]] == ["prepared"] * 5
    assert len(p.exchanges) == 2
    first = p.exchanges[0]
    assert first.analyst == "Erik Woodring"
    assert first.question_turns == [5, 7]  # follow-up stays in the same exchange
    assert first.answer_turns == [6, 8]
    assert p.exchanges[1].analyst == "Amit Daryanani"


def test_tone_counts_and_negation() -> None:
    c = count("We are pleased. Results may vary; conditions are uncertain. It is not good. A loss.")
    assert c["positive"] == 1  # "pleased" counts; "not good" does not
    assert c["uncertainty"] >= 2  # may, vary, uncertain
    assert c["negative"] >= 1  # loss


def test_score_call_per_speaker_and_section() -> None:
    p = parse_call(CALL)
    tone = score_call(CALL, p)
    luca = tone["speakers"]["Luca Maestri"]
    assert luca["role"] == "cfo"
    assert luca["prepared"]["uncertainty_rate"] > 0
    assert "qa" in luca
    assert tone["executives"]["all"]["words"] > 0
