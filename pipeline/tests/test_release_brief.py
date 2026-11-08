"""Verification of AI outputs for earnings releases and the brief (no network, no AI)."""

from __future__ import annotations

import gzip
from pathlib import Path

from ei.filings.brief import _numbers, verify_claims, xbrl_facts
from ei.filings.release import verify_release
from ei.filings.text import html_to_blocks

FIX = Path(__file__).parent / "fixtures" / "filings"


def msft_release() -> list[str]:
    return [
        b.text for b in html_to_blocks(gzip.decompress((FIX / "MSFT_8-K-EX99_2026-10-28.htm.gz").read_bytes()).decode())
    ]


def test_release_table_rows_stay_together() -> None:
    paras = msft_release()
    row = next(p for p in paras if p.startswith("Diluted earnings per share |"))
    assert "$4.92 | $(0.03) | $4.89 | $3.72" in row


def test_release_verification() -> None:
    paras = msft_release()
    row = next(i for i, p in enumerate(paras) if p.startswith("Diluted earnings per share |"))
    data = {
        "reports_non_gaap": True,
        "non_gaap_definition": None,
        "figures": [
            {
                "kind": "eps_adjusted",
                "label": "Non-GAAP diluted EPS",
                "current": 4.89,
                "prior": 4.13,
                "unit": "USD per share",
                "scale": "units",
                "basis": "quarter",
                "quote": paras[row],
                "para": row,
            },
            {
                "kind": "eps_gaap",
                "label": "Diluted EPS",
                "current": 4.95,
                "prior": None,
                "unit": "USD per share",
                "scale": "units",
                "basis": "quarter",
                "quote": paras[row],
                "para": row,
            },
            {
                "kind": "revenue",
                "label": "Revenue",
                "current": 92.3,
                "prior": None,
                "unit": "USD",
                "scale": "billions",
                "basis": "quarter",
                "quote": "Revenue was $92.3 billion and increased 19%",
                "para": 0,
            },
            {
                "kind": "net_income_adjusted",
                "label": "x",
                "current": 1.0,
                "prior": None,
                "unit": "USD",
                "scale": "millions",
                "basis": "quarter",
                "quote": "this text is not in the release at all",
                "para": 0,
            },
        ],
        "adjustments": [
            {
                "label": "Impact from OpenAI",
                "current": -0.03,
                "applies_to": "EPS",
                "scale": "units",
                "quote": paras[row],
                "para": row,
            }
        ],
    }
    kept, dropped = verify_release(data, paras)
    kinds = {f["kind"]: f for f in kept["figures"]}
    assert set(kinds) == {"eps_adjusted", "revenue"}  # wrong number and fake quote dropped
    assert kinds["revenue"]["value"] == 92.3e9
    assert kinds["eps_adjusted"]["prior"] == 4.13
    assert kept["reports_non_gaap"] and len(kept["adjustments"]) == 1
    assert len(dropped) == 2


def test_numbers_skip_years_and_quarters() -> None:
    assert _numbers("In FY2026 Q4 revenue rose 12% to $114.5B in 2026") == [12.0, 114.5]


def test_brief_claim_verification() -> None:
    facts = {
        "X1": {"text": "Revenue: FY2025Q4 $102.5B → FY2026Q4 $114.5B (+11.7%)"},
        "C1": {"text": "Guidance raised: Operating expenses", "quote": "between $20.4 billion and $20.8 billion"},
        "F1": {"text": "MD&A — Gross margin down", "quote": "gross margin decreased"},
    }
    raw = {
        "claims": [
            {"section": "results", "text": "Revenue grew 11.7% to $114.5B.", "refs": ["X1"]},
            {"section": "results", "text": "Revenue grew 12.4% to $114.5B.", "refs": ["X1"]},
            {"section": "guidance", "text": "Opex guide raised to $20.4–20.8 billion.", "refs": ["[C1]"]},
            {"section": "results", "text": "Something.", "refs": ["Z9"]},
            {"section": "tensions", "text": "Upbeat call vs filing.", "refs": ["C1"]},
            {"section": "tensions", "text": "Upbeat call while the filing says margin fell.", "refs": ["C1", "F1"]},
        ]
    }
    kept, dropped = verify_claims(raw, facts)
    assert [k["text"][:10] for k in kept] == ["Revenue gr", "Opex guide", "Upbeat cal"]
    assert len(dropped) == 3


def test_xbrl_facts_compute_changes_in_code() -> None:
    vals = {"revenue": {"A": 100e9, "B": 112e9}, "gross_margin": {"A": 0.46, "B": 0.479}}
    f = xbrl_facts(vals, "A", "B", {})
    assert "+12.0%" in f[0]["text"] and "+1.9 pp" in f[1]["text"]
