from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from ei.budget import BudgetExceeded, BudgetState, PricingUnverified, Usage, check_call, cost_usd
from ei.sectors import classify

PRICING: dict[str, Any] = {
    "verified": True,
    "batch_multiplier": 0.5,
    "models": {"m": {"input": 1.0, "output": 5.0, "cache_write_5m": 1.25, "cache_read": 0.1}},
}


def test_cost_math() -> None:
    u = Usage(input_tokens=1_000_000, output_tokens=200_000, cache_read_tokens=1_000_000)
    assert cost_usd("m", u, pricing=PRICING) == Decimal("2.100000")
    assert cost_usd("m", u, batch=True, pricing=PRICING) == Decimal("1.050000")


def test_guard_refuses_over_cap() -> None:
    state = BudgetState(Decimal("9.99"), Decimal("10"), Decimal("8"))
    with pytest.raises(BudgetExceeded, match="Monthly AI budget reached"):
        check_call(state, "m", Usage(input_tokens=100_000), pricing=PRICING)


def test_guard_allows_under_cap_and_warns() -> None:
    state = BudgetState(Decimal("8.50"), Decimal("10"), Decimal("8"))
    assert check_call(state, "m", Usage(input_tokens=1000), pricing=PRICING) == Decimal("0.001000")
    assert state.warning
    assert state.remaining == Decimal("1.50")


def test_guard_refuses_when_pricing_unverified() -> None:
    state = BudgetState(Decimal("0"), Decimal("10"), Decimal("8"))
    with pytest.raises(PricingUnverified):
        check_call(state, "m", Usage(input_tokens=1), pricing={**PRICING, "verified": False})


def test_shipped_pricing_is_unverified_until_checked() -> None:
    state = BudgetState(Decimal("0"), Decimal("10"), Decimal("8"))
    with pytest.raises(PricingUnverified):
        check_call(state, "claude-haiku-5-5", Usage(input_tokens=1))


@pytest.mark.parametrize(
    ("sic", "pack", "etf"),
    [
        ("6021", "bank", "XLF"),  # JPM
        ("6798", "reit", "XLRE"),  # O
        ("6331", "insurer", "XLF"),
        ("3571", "general", "XLK"),  # AAPL
        ("7372", "general", "XLK"),  # MSFT
        ("5331", "general", "XLY"),  # WMT (variety stores)
        ("2911", "general", "XLE"),  # XOM
        ("3674", "general", "XLK"),  # TSM (semiconductors)
        ("2834", "general", "XLV"),  # pharma
    ],
)
def test_sector_classification(sic: str, pack: str, etf: str) -> None:
    s = classify(sic)
    assert (s.pack, s.etf) == (pack, etf)
    assert s.ambiguous_reason is None


def test_ambiguous_sector_flagged() -> None:
    s = classify("6324")
    assert s.pack == "general" and s.ambiguous_reason


def test_predecessor_merge_successor_wins_overlap() -> None:
    from ei.predecessors import merge_companyfacts
    from ei.xbrl.normalize import normalize

    def rev(rows: list[tuple[str, str, float, str]]) -> dict[str, object]:
        return {
            "facts": {
                "us-gaap": {
                    "Revenues": {
                        "units": {
                            "USD": [
                                {"start": s, "end": e, "val": v, "filed": f, "accn": f, "form": "10-K"}
                                for s, e, v, f in rows
                            ]
                        }
                    }
                }
            }
        }

    new = rev([("2025-01-01", "2025-12-31", 300.0, "2026-02-20"), ("2024-01-01", "2024-12-31", 205.0, "2026-02-20")])
    old = rev([("2023-01-01", "2023-12-31", 190.0, "2024-02-20"), ("2024-01-01", "2024-12-31", 200.0, "2025-02-20")])
    nc = normalize(merge_companyfacts(new, [old]), "1231", "general")  # type: ignore[arg-type]
    assert nc.get("revenue", 2023, "FY").value == 190  # type: ignore[union-attr]  # only in predecessor
    assert nc.get("revenue", 2024, "FY").value == 205  # type: ignore[union-attr]  # successor's newer filing wins
    assert nc.get("revenue", 2025, "FY").value == 300  # type: ignore[union-attr]


def test_real_splits_filter() -> None:
    from datetime import date as d

    from ei.xbrl.normalize import real_splits

    raw = [
        (d(2014, 6, 9), 7.000007),
        (d(2020, 8, 31), 4.0),
        (d(2021, 11, 15), 1.032),
        (d(2022, 1, 3), 1.5),
        (d(2023, 5, 1), 0.1),
    ]
    assert real_splits(raw) == [(d(2014, 6, 9), 7.0), (d(2020, 8, 31), 4.0), (d(2022, 1, 3), 1.5), (d(2023, 5, 1), 0.1)]
