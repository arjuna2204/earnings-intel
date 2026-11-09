"""Hand-built companyfacts covering the edge cases the mapping must get right."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from ei.xbrl.derive import derive_all, valuation_snapshot
from ei.xbrl.normalize import FiscalCalendar, normalize


def fact(
    start: str | None, end: str, val: float, filed: str, accn: str = "0000-1", form: str = "10-Q"
) -> dict[str, Any]:
    f: dict[str, Any] = {"end": end, "val": val, "filed": filed, "accn": accn, "form": form}
    if start:
        f["start"] = start
    return f


def cf(us: dict[str, list[dict[str, Any]]], dei: dict[str, Any] | None = None) -> dict[str, Any]:
    units = {}
    for tag, facts in us.items():
        unit = "USD/shares" if "PerShare" in tag else ("shares" if "Shares" in tag else "USD")
        units[tag] = {"units": {unit: facts}}
    out: dict[str, Any] = {"facts": {"us-gaap": units}}
    if dei:
        out["facts"]["dei"] = dei
    return out


# Apple-like fiscal year ending late September (FY2024: 2023-10-01 .. 2024-09-28).
SEPT = {
    "Revenues": [
        fact("2023-10-01", "2023-12-30", 100, "2024-02-01"),  # Q1
        fact("2023-12-31", "2024-03-30", 80, "2024-05-01"),  # Q2
        fact("2024-03-31", "2024-06-29", 90, "2024-08-01"),  # Q3
        fact("2023-10-01", "2024-09-28", 400, "2024-11-01", "0000-K", "10-K"),  # FY -> Q4 = 130
        # Prior year FY (restated later: the later filing must win)
        fact("2022-09-25", "2023-09-30", 350, "2023-11-01", "0000-K0", "10-K"),
        fact("2022-09-25", "2023-09-30", 360, "2024-11-01", "0000-K", "10-K"),
    ],
    # Cash flow only reported year-to-date in 10-Qs
    "NetCashProvidedByUsedInOperatingActivities": [
        fact("2023-10-01", "2023-12-30", 30, "2024-02-01"),
        fact("2023-10-01", "2024-03-30", 50, "2024-05-01"),  # 6M -> Q2 = 20
        fact("2023-10-01", "2024-06-29", 85, "2024-08-01"),  # 9M -> Q3 = 35
        fact("2023-10-01", "2024-09-28", 120, "2024-11-01", "0000-K", "10-K"),  # FY -> Q4 = 35
    ],
    "PaymentsToAcquirePropertyPlantAndEquipment": [
        fact("2023-10-01", "2024-09-28", 20, "2024-11-01", "0000-K", "10-K"),
    ],
    "OperatingIncomeLoss": [fact("2023-10-01", "2024-09-28", 120, "2024-11-01", "0000-K", "10-K")],
    "DepreciationDepletionAndAmortization": [fact("2023-10-01", "2024-09-28", 30, "2024-11-01", "0000-K", "10-K")],
    "StockholdersEquity": [
        fact(None, "2024-09-28", 500, "2024-11-01", "0000-K", "10-K"),
        fact(None, "2023-09-30", 460, "2024-11-01", "0000-K", "10-K"),
        fact(None, "2024-03-30", 480, "2024-05-01"),
        fact(None, "2024-02-14", 999, "2024-05-01"),  # not a quarter end: must be ignored
    ],
    "NetIncomeLoss": [
        fact("2023-10-01", "2024-09-28", 96, "2024-11-01", "0000-K", "10-K"),
        fact("2022-09-25", "2023-09-30", 90, "2024-11-01", "0000-K", "10-K"),
    ],
    "LongTermDebt": [fact(None, "2024-09-28", 100, "2024-11-01", "0000-K", "10-K")],
    "CashAndCashEquivalentsAtCarryingValue": [fact(None, "2024-09-28", 40, "2024-11-01", "0000-K", "10-K")],
}


@pytest.fixture
def sept() -> Any:
    nc = normalize(cf(SEPT), "0928", "general")
    return derive_all(nc, "general")


def test_fiscal_calendar_labels() -> None:
    cal = FiscalCalendar.from_mmdd("0928")
    assert cal.label(date(2023, 12, 30)) == (2024, 1)
    assert cal.label(date(2024, 3, 30)) == (2024, 2)
    assert cal.label(date(2024, 6, 29)) == (2024, 3)
    assert cal.label(date(2024, 9, 28)) == (2024, 4)
    assert cal.label(date(2023, 9, 30)) == (2023, 4)  # 52/53-week drift


def test_january_fye_and_walmart_style() -> None:
    early = FiscalCalendar.from_mmdd("0102")  # 52/53-week year ending first days of January
    assert early.label(date(2025, 1, 3)) == (2024, 4)
    assert early.label(date(2024, 12, 28)) == (2024, 4)
    wmt = FiscalCalendar.from_mmdd("0131")  # Walmart FY2025 ends 2025-01-31
    assert wmt.label(date(2025, 1, 31)) == (2025, 4)
    assert wmt.label(date(2024, 4, 30)) == (2025, 1)


def test_q4_derived_from_fy(sept: Any) -> None:
    q4 = sept.get("revenue", 2024, "Q4")
    assert q4.value == pytest.approx(130)
    assert q4.source == "derived"
    assert "Full year" in q4.derivation
    assert sept.get("revenue", 2024, "Q1").source == "reported"


def test_restatement_latest_filing_wins(sept: Any) -> None:
    assert sept.get("revenue", 2023, "FY").value == 360


def test_ytd_cash_flow_split_into_quarters(sept: Any) -> None:
    assert sept.get("operating_cash_flow", 2024, "Q2").value == pytest.approx(20)
    assert sept.get("operating_cash_flow", 2024, "Q3").value == pytest.approx(35)
    assert sept.get("operating_cash_flow", 2024, "Q4").value == pytest.approx(35)


def test_ttm_is_sum_of_four_quarters(sept: Any) -> None:
    assert sept.get("revenue_ttm", 2024, "Q4").value == pytest.approx(400)


def test_instants_only_at_quarter_ends(sept: Any) -> None:
    assert sept.get("total_equity", 2024, "Q2").value == 480
    assert sept.get("total_equity", 2024, "FY").value == 500
    assert sept.get("total_equity", 2024, "Q4").value == 500
    assert all(pv.value != 999 for pv in sept.values.values())


def test_derived_metrics(sept: Any) -> None:
    assert sept.get("free_cash_flow", 2024, "FY").value == pytest.approx(100)
    assert sept.get("ebitda", 2024, "FY").value == pytest.approx(150)
    assert sept.get("net_debt", 2024, "FY").value == pytest.approx(60)
    assert sept.get("revenue_growth_yoy", 2024, "FY").value == pytest.approx(400 / 360 - 1)
    assert sept.get("roe", 2024, "FY").value == pytest.approx(96 / 480)
    assert sept.get("fcf_margin", 2024, "FY").value == pytest.approx(0.25)


def test_unresolved_reported_not_guessed(sept: Any) -> None:
    assert "inventory" in sept.unresolved
    assert sept.get("inventory", 2024, "FY") is None


def test_tag_switch_falls_back_per_period() -> None:
    data = cf(
        {
            "SalesRevenueNet": [fact("2016-01-01", "2016-12-31", 10, "2017-02-01", "a", "10-K")],
            "RevenueFromContractWithCustomerExcludingAssessedTax": [
                fact("2019-01-01", "2019-12-31", 20, "2020-02-01", "b", "10-K")
            ],
        }
    )
    nc = normalize(data, "1231", "general")
    assert nc.get("revenue", 2016, "FY").xbrl_tag == "us-gaap:SalesRevenueNet"
    assert nc.get("revenue", 2019, "FY").xbrl_tag == "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"


def test_eps_q4_marked_approximate() -> None:
    data = cf(
        {
            "EarningsPerShareDiluted": [
                fact("2024-01-01", "2024-03-31", 1.0, "2024-05-01"),
                fact("2024-04-01", "2024-06-30", 1.1, "2024-08-01"),
                fact("2024-07-01", "2024-09-30", 1.2, "2024-11-01"),
                fact("2024-01-01", "2024-12-31", 4.6, "2025-02-01", "k", "10-K"),
            ],
            "WeightedAverageNumberOfDilutedSharesOutstanding": [
                fact("2024-01-01", "2024-12-31", 1000, "2025-02-01", "k", "10-K"),
            ],
        }
    )
    nc = normalize(data, "1231", "general")
    q4 = nc.get("eps_diluted", 2024, "Q4")
    assert q4.value == pytest.approx(1.3)
    assert "approximate" in q4.derivation
    # Share counts are not additive: no Q4 derived by subtraction.
    assert nc.get("diluted_shares", 2024, "Q4") is None


def test_bank_pack_ratios() -> None:
    us = {
        "InterestIncomeExpenseNet": [fact("2024-01-01", "2024-12-31", 90, "2025-02-01", "k", "10-K")],
        "NoninterestIncome": [fact("2024-01-01", "2024-12-31", 60, "2025-02-01", "k", "10-K")],
        "NoninterestExpense": [fact("2024-01-01", "2024-12-31", 90, "2025-02-01", "k", "10-K")],
        "Deposits": [fact(None, "2024-12-31", 1000, "2025-02-01", "k", "10-K")],
        "LoansAndLeasesReceivableNetReportedAmount": [fact(None, "2024-12-31", 700, "2025-02-01", "k", "10-K")],
        "Revenues": [fact("2024-01-01", "2024-12-31", 150, "2025-02-01", "k", "10-K")],
    }
    nc = derive_all(normalize(cf(us), "1231", "bank"), "bank")
    assert nc.get("efficiency_ratio", 2024, "FY").value == pytest.approx(0.6)
    assert nc.get("loan_to_deposit", 2024, "FY").value == pytest.approx(0.7)
    assert "net_interest_margin" in nc.unresolved  # not in XBRL -> extracted later, never guessed


def test_valuation_snapshot_uses_cover_shares() -> None:
    dei = {
        "EntityCommonStockSharesOutstanding": {
            "units": {
                "shares": [
                    {"end": "2024-10-18", "val": 60, "filed": "2024-11-01", "accn": "k"},
                    {"end": "2024-10-18", "val": 40, "filed": "2024-11-01", "accn": "k"},  # second share class
                ]
            }
        }
    }
    us = dict(SEPT)
    us["EarningsPerShareDiluted"] = [fact("2023-10-01", "2024-09-28", 1.0, "2024-11-01", "0000-K", "10-K")]
    nc = derive_all(normalize(cf(us, dei), "0928", "general"), "general")
    snap = valuation_snapshot(nc, "general", 10.0, "2024-11-05")
    assert snap["market_cap"] == pytest.approx(1000)
    assert snap["enterprise_value"] == pytest.approx(1000 + 100 - 40)


def test_non_usd_reporter_skips_usd_multiples() -> None:
    data = {
        "facts": {
            "ifrs-full": {
                "Revenue": {"units": {"TWD": [fact("2024-01-01", "2024-12-31", 1000, "2025-04-01", "k", "20-F")]}},
                "Assets": {"units": {"TWD": [fact(None, "2024-12-31", 5000, "2025-04-01", "k", "20-F")]}},
            }
        }
    }
    nc = derive_all(normalize(data, "1231", "general"), "general")
    assert nc.currency == "TWD"
    assert nc.get("revenue", 2024, "FY").unit == "TWD"
    snap = valuation_snapshot(nc, "general", 150.0, "2025-04-02")
    assert "note" in snap and "market_cap" not in snap


def test_valuation_snapshot_blanks_market_value_when_shares_are_only_by_class() -> None:
    """Visa: net income but no company-wide EPS or diluted shares; the cover lists one class only."""
    dei = {
        "EntityCommonStockSharesOutstanding": {
            "units": {"shares": [{"end": "2024-10-18", "val": 10, "filed": "2024-11-01", "accn": "k"}]}
        }
    }
    us = dict(SEPT)
    us["NetIncomeLoss"] = [fact("2023-10-01", "2024-09-28", 50, "2024-11-01", "0000-K", "10-K")]
    us.pop("EarningsPerShareDiluted", None)
    nc = derive_all(normalize(cf(us, dei), "0928", "general"), "general")
    snap = valuation_snapshot(nc, "general", 10.0, "2024-11-05")
    assert snap["market_cap"] is None
    assert "share class" in str(snap["shares_note"])
