from __future__ import annotations

from ei.calls.extract import SCHEMA, Extraction, evasiveness_rows, verify_extraction
from ei.calls.parse import parse_call
from ei.verify import locate, normalize, quote_in
from tests.test_calls_parse_tone import CALL


def test_normalize_whitespace_and_typography_only() -> None:
    assert normalize("We’re  pleased\n with growth — a lot") == "We're pleased with growth - a lot"
    assert quote_in("we’re   pleased with", "Today we're pleased with results")
    assert not quote_in("We're pleased with", "Today we're pleased with results")  # case is not changed
    assert not quote_in("pleased", "pleased")  # too short to count as a quote


def test_locate_prefers_cited_turn_then_searches() -> None:
    sources = ["alpha beta gamma delta", "we expect gross margin between 46% and 47%"]
    assert locate("gross margin between 46% and 47%", sources, preferred=1) == 1
    assert locate("gross margin between 46% and 47%", sources, preferred=0) == 1  # wrong turn cited -> fixed
    assert locate("gross margin of 50%", sources) is None


def test_verify_drops_invented_quotes_and_fixes_turns() -> None:
    parsed = parse_call(CALL)
    ex = Extraction.model_validate(
        {
            "guidance": [
                {
                    "metric": "Gross margin",
                    "period": "next quarter",
                    "low": 46,
                    "high": 47,
                    "point": None,
                    "unit": "%",
                    "qualitative": None,
                    "withdrawn": False,
                    "quote": "We expect gross margin between 46% and 47%.",
                    "turn": 2,
                },
                {
                    "metric": "Revenue",
                    "period": "next quarter",
                    "low": None,
                    "high": None,
                    "point": 100,
                    "unit": "USD billions",
                    "qualitative": None,
                    "withdrawn": False,
                    "quote": "We expect revenue of $100 billion next quarter.",
                    "turn": 3,
                },
            ],
            "kpis": [],
            "risks": [
                {
                    "label": "Uncertain conditions",
                    "summary": "Results may vary.",
                    "quote": "Results may vary due to uncertain conditions",
                    "turn": 3,
                }
            ],
            "topics": [
                {
                    "label": "Gross margin",
                    "summary": "Outlook.",
                    "quote": "Can you talk about gross margin?",
                    "turn": 5,
                    "turns": [5, 6, 99],
                }
            ],
            "qa_scores": [
                {"exchange": 0, "evasiveness": 0.6, "reason": "Declined to break out China."},
                {"exchange": 7, "evasiveness": 0.1, "reason": "no such exchange"},
            ],
        }
    )
    kept, dropped = verify_extraction(ex, CALL, parsed)
    assert len(kept["guidance"]) == 1 and kept["guidance"][0]["turn"] == 6  # cited 2, actually 6
    assert kept["guidance"][0]["role"] == "cfo" and kept["guidance"][0]["section"] == "qa"
    assert len(dropped) == 1 and dropped[0]["item"]["metric"] == "Revenue"  # invented quote dropped
    assert kept["topics"][0]["turns"] == [5, 6]  # out-of-range turn ids removed
    rows = evasiveness_rows(ex, parsed)
    assert [r["exchange"] for r in rows] == [0] and rows[0]["analyst"] == "Erik Woodring"


def test_schema_is_strict() -> None:
    assert SCHEMA["additionalProperties"] is False
    g = SCHEMA["properties"]["guidance"]["items"]
    assert set(g["required"]) == set(g["properties"])
