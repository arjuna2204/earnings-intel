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


def test_guidance_numbers_must_be_in_the_quote() -> None:
    from ei.calls.extract import check_guidance_numbers

    ok = check_guidance_numbers(
        {
            "low": 18.1,
            "high": 18.5,
            "point": None,
            "quote": "between $18.1 billion and $18.5 billion",
            "qualitative": None,
        }
    )
    assert ok["low"] == 18.1 and "numbers_removed" not in ok
    inferred = check_guidance_numbers(
        {
            "low": None,
            "high": None,
            "point": 14,
            "quote": "mirroring the same year-over-year rate we reported",
            "qualitative": None,
        }
    )
    assert inferred["point"] is None and inferred["numbers_removed"] and inferred["qualitative"].startswith("mirroring")
    commas = check_guidance_numbers(
        {"low": None, "high": None, "point": 1250, "quote": "about 1,250 stores", "qualitative": None}
    )
    assert commas["point"] == 1250


def test_paraphrased_topic_quote_is_replaced_from_its_turns() -> None:
    parsed = parse_call(CALL)
    ex = Extraction.model_validate(
        {
            "guidance": [],
            "kpis": [],
            "risks": [],
            "qa_scores": [],
            "topics": [
                {
                    "label": "Gross margin outlook",
                    "summary": "Margins.",
                    "quote": "Margins will be about 46 to 47 percent.",
                    "turn": 6,
                    "turns": [5, 6],
                }
            ],
        }
    )
    kept, dropped = verify_extraction(ex, CALL, parsed)
    assert len(kept["topics"]) == 1
    t = kept["topics"][0]
    assert t["quote_selected_by_code"] and t["quote"] in CALL[t["turn"]].content
    assert dropped[0]["reason"].startswith("quote replaced")


def test_guidance_number_at_a_different_scale_is_accepted() -> None:
    from ei.calls.extract import check_guidance_numbers

    item = check_guidance_numbers(
        {
            "low": None,
            "high": None,
            "point": 0.3,
            "unit": "USD billions",
            "quote": "We expect OI&E to be around $300 million",
            "qualitative": None,
        }
    )
    assert item["point"] == 0.3 and "numbers_removed" not in item
