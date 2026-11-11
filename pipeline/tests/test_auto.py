from datetime import date

from ei.auto import pair_for


def test_pair_is_latest_vs_year_ago() -> None:
    evs = [
        {"fiscal_year": 2026, "fiscal_quarter": 3, "report_date": "2026-11-04"},
        {"fiscal_year": 2026, "fiscal_quarter": 2, "report_date": "2026-08-05"},
        {"fiscal_year": 2026, "fiscal_quarter": 4, "report_date": "2027-02-10"},  # not reported yet
    ]
    assert pair_for(evs, date(2026, 11, 11)) == ("FY2025Q3", "FY2026Q3")


def test_stale_or_empty_gives_nothing() -> None:
    assert pair_for([], date(2026, 11, 11)) is None
    old = [{"fiscal_year": 2025, "fiscal_quarter": 4, "report_date": "2026-02-01"}]
    assert pair_for(old, date(2026, 11, 11)) is None
