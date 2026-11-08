"""Filing text parsing on real 10-Ks (Apple FY2025/FY2026, Microsoft FY2025/FY2026)."""

from __future__ import annotations

import gzip
from functools import cache
from pathlib import Path

from ei.embed import OverlapEmbedder
from ei.filings.risk import compare_risk_factors, escalation_flags, redline, split_risk_factors
from ei.filings.text import Block, Section, extract_sections, html_to_blocks

FIX = Path(__file__).parent / "fixtures" / "filings"


@cache
def sections(name: str) -> dict[str, Section]:
    return extract_sections("10-K", gzip.decompress((FIX / f"{name}.htm.gz").read_bytes()).decode())


def test_split_words_across_spans_are_rejoined() -> None:
    blocks = html_to_blocks(
        '<p><span style="font-weight:bold">B</span><span style="font-weight:bold">USINESS</span></p>'
    )
    assert blocks[0].text == "BUSINESS" and blocks[0].bold


def test_run_in_bold_heading_detected() -> None:
    b = html_to_blocks("<p><b>We may fail.</b> Body text here that is not bold.</p>")[0]
    assert b.lead_bold == "We may fail." and not b.bold


def test_hidden_xbrl_header_dropped() -> None:
    blocks = html_to_blocks('<div style="display:none">hidden dei facts</div><p>Visible</p>')
    assert [b.text for b in blocks] == ["Visible"]


def test_items_found_and_toc_skipped() -> None:
    for name in ("AAPL_10-K_2026-09-26", "MSFT_10-K_2026-06-30", "AAPL_10-K_2025-09-27", "MSFT_10-K_2025-06-30"):
        s = sections(name)
        assert set(s) == {"business", "risk_factors", "mdna"}, name
        assert len(s["risk_factors"].text) > 50_000, name
        assert len(s["mdna"].text) > 15_000, name
        # running page heads ("Item 1A", "PART I") don't leak into the text
        assert not any(b.text in {"Item 1A", "PART I", "Item 1B, 1C"} for b in s["risk_factors"].blocks), name
    assert sections("AAPL_10-K_2026-09-26")["risk_factors"].blocks[0].text.startswith("The following summarizes")
    assert sections("MSFT_10-K_2026-06-30")["mdna"].blocks[0].text.startswith("The following Management")


def test_risk_factor_headlines() -> None:
    aapl = split_risk_factors(sections("AAPL_10-K_2026-09-26")["risk_factors"])
    msft = split_risk_factors(sections("MSFT_10-K_2026-06-30")["risk_factors"])
    assert 20 <= len(aapl) <= 40 and 15 <= len(msft) <= 40
    assert aapl[0].category == "Macroeconomic and Industry Risks"
    assert aapl[0].headline.startswith("The Company’s operations and performance depend significantly")
    assert msft[0].headline.startswith("We face intense competition")
    # Microsoft run-in headings (bold sentence starting a paragraph) are separate factors
    assert any(f.headline.startswith("Our cloud and AI strategy requires substantial investments") for f in msft)
    # bold-italic sub-headings stay inside their factor
    assert "Competition in the technology sector" in msft[0].body


def test_compare_aapl_years() -> None:
    new = split_risk_factors(sections("AAPL_10-K_2026-09-26")["risk_factors"])
    old = split_risk_factors(sections("AAPL_10-K_2025-09-27")["risk_factors"])
    ch = compare_risk_factors(new, old, OverlapEmbedder())
    status = {c.status for c in ch}
    assert "modified" in status
    added = [c for c in ch if c.status == "added"]
    assert any("artificial intelligence" in c.new.headline for c in added if c.new)
    # every new and old factor is accounted for exactly once
    assert sorted(c.new.idx for c in ch if c.new) == list(range(len(new)))
    assert sorted(c.old.idx for c in ch if c.old) == list(range(len(old)))


def test_redline_and_escalation() -> None:
    ops, added, removed = redline("Such events may harm the business.", "Such events have harmed the business.")
    assert added == 2 and removed == 2
    assert escalation_flags(ops)
    ops2, _, _ = redline("We may face shortages.", "We have experienced, and may continue to experience, shortages.")
    assert any("have experienced" in f for f in escalation_flags(ops2))
    assert not escalation_flags(redline("We sell phones.", "We sell many phones.")[0])


def test_fallback_without_headings() -> None:
    long = "Risk sentence one is here. " + "Detail " * 40
    sec = Section("1A", "Risk Factors", [Block(long), Block(long.replace("one", "two"))])
    f = split_risk_factors(sec)
    assert len(f) == 2 and f[0].headline == "Risk sentence one is here."


def test_bank_10q_mdna_found_through_table_of_contents() -> None:
    """JPMorgan's 10-Q has no 'Item 2.' heading in the body; MD&A is located via the contents page."""
    s = extract_sections("10-Q", gzip.decompress((FIX / "JPM_10-Q_2026-09-30.htm.gz").read_bytes()).decode())
    m = s["mdna"]
    assert m.blocks[0].text.startswith("Consolidated financial highlights")
    assert 100_000 < len(m.text) < 400_000  # stops before the financial statements
    assert not any(b.text == "Consolidated statements of income (unaudited)" for b in m.blocks)


def test_10q_mdna_regular_layout() -> None:
    s = extract_sections("10-Q", gzip.decompress((FIX / "MSFT_10-Q_2026-09-30.htm.gz").read_bytes()).decode())
    assert len(s["mdna"].text) > 20_000
