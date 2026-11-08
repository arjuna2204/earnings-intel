from __future__ import annotations

from datetime import date, timedelta

import pytest

from ei.calls.compare import compare_guidance, compare_topics, price_reaction
from ei.embed import OverlapEmbedder, greedy_match


def g(
    metric: str,
    period: str,
    low: float | None = None,
    high: float | None = None,
    point: float | None = None,
    unit: str = "%",
    withdrawn: bool = False,
) -> dict[str, object]:
    return {
        "metric": metric,
        "period": period,
        "low": low,
        "high": high,
        "point": point,
        "unit": unit,
        "qualitative": None,
        "withdrawn": withdrawn,
        "quote": "q",
        "turn": 0,
    }


def test_guidance_labels() -> None:
    earlier = [
        g("Gross margin", "next quarter", 45, 46),
        g("Revenue growth", "next quarter", point=5, unit="% growth y/y"),
        g("Operating expenses", "next quarter", 14.2, 14.4, unit="USD billions"),
        g("Tax rate", "next quarter", point=16),
        g("Buybacks", "full year", point=90, unit="USD billions"),
    ]
    later = [
        g("Gross margin", "next quarter", 46, 47),  # raised
        g("Revenue growth", "next quarter", point=3, unit="% growth y/y"),  # lowered
        g("Operating expenses", "next quarter", 14.25, 14.35, unit="USD billions"),  # same midpoint -> maintained
        g("Tax rate", "next quarter", point=16, unit="USD billions"),  # unit mismatch
        g("Capex", "full year", point=12, unit="USD billions"),  # new
    ]
    rows = {r["metric"]: r for r in compare_guidance(earlier, later)}
    assert rows["Gross margin"]["change"] == "raised"
    assert rows["Gross margin"]["delta"] == pytest.approx(1.0)
    assert rows["Revenue growth"]["change"] == "lowered"
    assert rows["Operating expenses"]["change"] == "maintained"
    assert rows["Tax rate"]["change"] == "changed basis"
    assert rows["Capex"]["change"] == "new"
    assert rows["Buybacks"]["change"] == "not repeated"  # silently dropped, not explicitly withdrawn


def test_guidance_explicitly_withdrawn_and_horizon_mismatch() -> None:
    earlier = [g("Revenue", "full year 2025", point=100, unit="USD billions")]
    later = [
        g("Revenue", "full year 2026", withdrawn=True, unit="USD billions"),
        g("Revenue", "next quarter", point=30, unit="USD billions"),
    ]
    rows = compare_guidance(earlier, later)
    changes = sorted(r["change"] for r in rows)
    assert "withdrawn" in changes and "new" in changes  # quarterly guide is not compared to the annual one


def test_topics_new_dropped_expanded() -> None:
    earlier = [
        {"label": "China demand", "summary": "Demand in Greater China", "turns": [1]},
        {"label": "Services growth", "summary": "Services revenue growth", "turns": [2]},
        {"label": "Supply constraints", "summary": "Chip supply limits", "turns": [3]},
    ]
    later = [
        {"label": "Services growth", "summary": "Services revenue growth record", "turns": [1, 2]},
        {"label": "China demand", "summary": "Demand in Greater China weak", "turns": [3]},
        {"label": "AI features", "summary": "Generative AI features", "turns": [4]},
    ]
    words_a = [100, 200, 200, 200, 300]
    words_b = [100, 200, 300, 50, 350]
    rows = {r["label"]: r for r in compare_topics(earlier, later, words_a, words_b, OverlapEmbedder())}
    assert rows["AI features"]["change"] == "new"
    assert rows["Supply constraints"]["change"] == "dropped"
    assert rows["Services growth"]["change"] == "expanded"  # 0.2 -> 0.5 share of words


def test_greedy_match_is_one_to_one() -> None:
    assert greedy_match([[0.9, 0.8], [0.85, 0.1]], 0.5) == [(0, 0, 0.9)]


def _series(start: date, closes: list[float]) -> list[tuple[date, float]]:
    out, d = [], start
    for c in closes:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append((d, c))
        d += timedelta(days=1)
    return out


def test_price_reaction_after_close_and_before_open() -> None:
    px = _series(date(2026, 1, 26), [100, 100, 100, 110, 111, 112, 113, 114, 115])  # Mon..
    etf = _series(date(2026, 1, 26), [50, 50, 50, 51, 51, 51, 51, 51, 51])
    # Reported Wed 2026-01-28 after close: base = Wed close (100), next day 110 -> +10%.
    r = price_reaction(date(2026, 1, 28), "post-market", px, etf)
    assert r is not None and r["r1"] == pytest.approx(0.10) and r["excess_r1"] == pytest.approx(0.10 - 0.02)
    assert r["r5"] == pytest.approx(114 / 100 - 1)  # 5 trading days after Wed close = next Wed
    # Reported Thu before the open: base = Wed close too.
    r2 = price_reaction(date(2026, 1, 29), "pre-market", px, etf)
    assert r2 is not None and r2["base_date"] == "2026-01-28"


def test_units_on_a_common_scale() -> None:
    earlier = [g("Other income", "next quarter", point=150, unit="USD millions")]
    later = [g("Other income", "next quarter", point=0.3, unit="USD billions")]
    row = compare_guidance(earlier, later)[0]
    assert row["change"] == "raised"
    assert row["delta"] == pytest.approx(0.15)  # in the later item's unit (USD billions)


def test_metrics_with_incompatible_units_are_not_paired() -> None:
    earlier = [g("iPhone revenue growth", "next quarter", point=10, unit="% growth y/y")]
    later = [g("Operating expenses", "next quarter", 20.4, 20.8, unit="USD billions")]
    changes = sorted(r["change"] for r in compare_guidance(earlier, later))
    assert changes == ["new", "not repeated"]
