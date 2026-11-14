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


def test_brief_with_timeout_stops_a_stuck_company(monkeypatch):
    import time

    from ei import auto

    def stuck(*a, **k):
        time.sleep(30)

    monkeypatch.setattr("ei.filings.run.run_brief", stuck)
    t = time.time()
    res = auto.brief_with_timeout(None, "BRK-A", "FY2025Q3", "FY2026Q3", False, timeout_s=1)  # type: ignore[arg-type]
    assert res["timeout"] and not res["ok"]
    assert time.time() - t < 15


def test_brief_with_timeout_returns_the_result(monkeypatch):
    from ei import auto

    monkeypatch.setattr("ei.filings.run.run_brief", lambda *a, **k: {"ok": True})
    assert auto.brief_with_timeout(None, "AAPL", "a", "b", False, timeout_s=10) == {"ok": True}  # type: ignore[arg-type]
