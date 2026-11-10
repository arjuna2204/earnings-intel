from ei.recap import reaction, surprise

CLOSES = [("2026-11-04", 100.0), ("2026-11-05", 101.0), ("2026-11-06", 110.0), ("2026-11-09", 108.0)]


def test_reaction_spans_close_before_to_close_after() -> None:
    # reported Thursday 11-05 (either before the open or after the close): Wed close -> Fri close
    move, a, b = reaction(CLOSES, "2026-11-05")  # type: ignore[misc]
    assert (a, b) == ("2026-11-04", "2026-11-06") and abs(move - 0.10) < 1e-9


def test_reaction_on_weekend_report_and_missing_data() -> None:
    _move, a, b = reaction(CLOSES, "2026-11-07")  # type: ignore[misc]
    assert (a, b) == ("2026-11-06", "2026-11-09")
    assert reaction(CLOSES, "2026-11-09") is None  # no session after it yet
    assert reaction([], "2026-11-05") is None


def test_surprise() -> None:
    assert surprise(1.10, 1.00) == 0.10000000000000009
    assert surprise(-0.5, -1.0) == 0.5  # smaller loss than expected = beat
    assert surprise(None, 1.0) is None and surprise(1.0, 0) is None
