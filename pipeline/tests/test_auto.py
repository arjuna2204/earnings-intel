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


def test_latest_quarter_uses_fy_as_q4() -> None:
    from ei.auto import latest_quarters

    rows = [
        {"cik": 1, "fiscal_year": 2026, "fiscal_period": "Q3", "period_end": "2026-09-30"},
        {"cik": 1, "fiscal_year": 2026, "fiscal_period": "Q2", "period_end": "2026-06-30"},
        {"cik": 2, "fiscal_year": 2026, "fiscal_period": "FY", "period_end": "2026-09-27"},
        {"cik": 2, "fiscal_year": 2026, "fiscal_period": "Q3", "period_end": "2026-06-28"},
    ]
    assert latest_quarters(rows) == {1: (2026, 3, "2026-09-30"), 2: (2026, 4, "2026-09-27")}
