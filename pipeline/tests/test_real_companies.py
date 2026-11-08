"""Mapping tests on saved SEC companyfacts for AAPL, MSFT, JPM, WMT, XOM, O (REIT) and TSM (foreign, IFRS).

Expected values are the figures printed in each company's 10-K / 20-F.
"""

from __future__ import annotations

import gzip
import json
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from ei.sectors import classify
from ei.xbrl.derive import derive_all
from ei.xbrl.normalize import NormalizedCompany, normalize

FIX = Path(__file__).parent / "fixtures"


@cache
def company(ticker: str) -> tuple[NormalizedCompany, dict[str, Any]]:
    with gzip.open(FIX / f"{ticker}.json.gz", "rt") as f:
        facts = json.load(f)
    meta = json.loads((FIX / f"{ticker}.meta.json").read_text())
    pack = classify(meta["sic"]).pack
    return derive_all(normalize(facts, meta["fiscalYearEnd"], pack, min_fiscal_year=2010), pack), meta


def val(ticker: str, metric: str, fy: int, fp: str = "FY") -> float:
    pv = company(ticker)[0].get(metric, fy, fp)
    assert pv is not None, f"{ticker} {metric} {fp} FY{fy} missing"
    return pv.value


M = 1e6


@pytest.mark.parametrize(
    ("ticker", "metric", "fy", "expected"),
    [
        ("AAPL", "revenue", 2024, 391_035 * M),
        ("AAPL", "net_income", 2024, 93_736 * M),
        ("AAPL", "eps_diluted", 2024, 6.08),
        ("MSFT", "revenue", 2024, 245_122 * M),
        ("MSFT", "net_income", 2024, 88_136 * M),
        ("MSFT", "eps_diluted", 2024, 11.80),
        ("MSFT", "revenue", 2025, 281_724 * M),
        ("JPM", "net_income", 2024, 58_471 * M),  # not the rounded 58.5B from the proxy statement
        ("JPM", "eps_diluted", 2024, 19.75),
        ("WMT", "revenue", 2025, 680_985 * M),  # FY2025 ended 2025-01-31
        ("WMT", "net_income", 2025, 19_436 * M),
        ("XOM", "net_income", 2024, 33_680 * M),
        ("XOM", "eps_diluted", 2024, 7.84),
        ("O", "revenue", 2024, 5_271.1 * M),
        ("O", "net_income", 2024, 860.8 * M),
        ("TSM", "revenue", 2024, 2_894_307.7 * M),  # TWD, IFRS 20-F
    ],
)
def test_reported_values_match_filings(ticker: str, metric: str, fy: int, expected: float) -> None:
    assert val(ticker, metric, fy) == pytest.approx(expected, rel=2e-4)


@pytest.mark.parametrize(("ticker", "fye"), [("AAPL", "09"), ("MSFT", "0630"), ("WMT", "0131"), ("XOM", "1231")])
def test_fiscal_year_end(ticker: str, fye: str) -> None:
    assert (company(ticker)[0].fiscal_year_end or "").startswith(fye)


@pytest.mark.parametrize("ticker", ["AAPL", "MSFT", "WMT", "XOM", "JPM"])
def test_quarters_sum_to_year(ticker: str) -> None:
    """Quarters add up to the year, except where the full year was restated in a later filing
    (e.g. MSFT FY2016 recast for ASC 606) while the quarters stayed as originally reported."""
    nc = company(ticker)[0]
    checked = 0
    for fy in range(2016, 2025):
        qs = [nc.get("revenue", fy, q) for q in ("Q1", "Q2", "Q3", "Q4")]
        annual = nc.get("revenue", fy, "FY")
        if not (annual and all(qs)):
            continue
        checked += 1
        total = sum(q.value for q in qs if q)
        if total != pytest.approx(annual.value, rel=1e-6):
            assert annual.filed and all(q.filed and annual.filed > q.filed for q in qs if q), (
                f"{ticker} FY{fy}: quarters {total} != year {annual.value} without a later restatement"
            )
    assert checked >= 5


@pytest.mark.parametrize("ticker", ["AAPL", "MSFT", "WMT", "XOM", "TSM"])
def test_core_metrics_resolved(ticker: str) -> None:
    nc = company(ticker)[0]
    latest = max(fy for (m, fy, fp) in nc.values if m == "revenue" and fp == "FY")
    for metric in ("revenue", "net_income", "operating_cash_flow", "free_cash_flow", "total_debt", "net_debt"):
        assert nc.get(metric, latest, "FY") is not None, f"{ticker} {metric} FY{latest}"


def test_fifteen_years_of_history() -> None:
    nc = company("AAPL")[0]
    years = {fy for (m, fy, fp) in nc.values if m == "revenue" and fp == "FY"}
    assert len(years) >= 15


def test_bank_pack_on_jpm() -> None:
    nc = company("JPM")[0]
    eff = val("JPM", "efficiency_ratio", 2024)
    assert 0.4 < eff < 0.7
    assert 0.4 < val("JPM", "loan_to_deposit", 2024) < 0.8
    assert "net_interest_margin" in nc.unresolved  # extracted later, never guessed
    assert "operating_income" in nc.unresolved  # banks don't report it; shown as "Not reported"


def test_reit_pack_on_o() -> None:
    nc = company("O")[0]
    assert {"ffo", "affo", "occupancy"} <= set(nc.unresolved)


def test_foreign_filer_keeps_native_currency() -> None:
    nc = company("TSM")[0]
    assert nc.currency == "TWD"
    assert nc.get("revenue", 2024, "FY").unit == "TWD"  # type: ignore[union-attr]


def test_no_value_comes_from_proxy_statements() -> None:
    for t in ("AAPL", "MSFT", "JPM", "WMT", "XOM", "O"):
        for pv in company(t)[0].values.values():
            assert pv.accession is None or not pv.accession.endswith("DEF14A")
