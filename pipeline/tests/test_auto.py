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


def test_run_overlaps_companies_and_respects_limits(monkeypatch):
    import os
    import time as _t

    from ei import auto

    companies = [{"cik": i, "ticker": f"T{i}", "a": "FY2025Q3", "b": "FY2026Q3", "reported": "x"} for i in range(6)]
    started: list[str] = []
    live = {"now": 0, "max": 0}

    class Proc:
        def __init__(self, t: str) -> None:
            self.t, self.until, self.exitcode = t, _t.monotonic() + 0.3, 0
            live["now"] += 1
            live["max"] = max(live["max"], live["now"])
            self.closed = False

        def is_alive(self) -> bool:
            alive = _t.monotonic() < self.until
            if not alive and not self.closed:
                self.closed = True
                live["now"] -= 1
            return alive

    def fake_start(settings, ticker, a, b, skip_calls):
        assert os.environ["EI_AI_BATCH"] == "1" and os.environ["EI_RATE_SHARE"] == "3"
        started.append(ticker)
        return Proc(ticker), None

    class Db:
        def __init__(self, *a): ...

    monkeypatch.setattr(auto, "Db", Db)
    monkeypatch.setattr(auto, "parked", lambda db, today: {})
    monkeypatch.setattr(auto, "queue", lambda db, today: companies)
    monkeypatch.setattr(auto, "budget_state", lambda db: type("B", (), {"spent_usd": 1})())
    monkeypatch.setattr(auto, "calls_needed", lambda *a: 0)
    monkeypatch.setattr(auto, "av_used", lambda db: 0)
    monkeypatch.setattr(auto, "start_brief", fake_start)
    monkeypatch.setattr(auto, "result_of", lambda p, out: {"ok": True})
    monkeypatch.setattr(auto, "catch_up_calls", lambda *a: [])
    settings = type("S", (), {"supabase_url": "", "supabase_secret_key": ""})()

    res = auto.run(settings, max_companies=5, workers=3, poll_s=0.05)  # type: ignore[arg-type]
    assert res["written"] == ["T0", "T1", "T2", "T3", "T4"] or sorted(res["written"]) == ["T0", "T1", "T2", "T3", "T4"]
    assert live["max"] == 3 and len(started) == 5
    assert res["stopped"] == "daily limit of 5 companies"
    assert "EI_AI_BATCH" not in os.environ and "EI_RATE_SHARE" not in os.environ
