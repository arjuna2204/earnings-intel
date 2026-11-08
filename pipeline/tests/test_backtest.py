"""Backtest math (no network)."""

from __future__ import annotations

from datetime import date, timedelta

from ei.backtest import bootstrap_spread, event_returns, spearman, summarize, verdict


def series(start: date, prices: list[float]) -> tuple[list[date], list[float]]:
    return [start + timedelta(days=i) for i in range(len(prices))], prices


def test_event_returns_after_close_uses_next_day() -> None:
    d0 = date(2026, 1, 1)
    stock = series(d0, [100, 100, 110] + [110 * (1.001**i) for i in range(1, 80)])
    bench = series(d0, [100.0] * 82)
    r = event_returns(stock, bench, d0 + timedelta(days=1), before_open=False)
    assert abs(r["reaction"] - 0.10) < 1e-9  # day 2 vs day 1
    assert abs(r["drift20"] - (1.001**20 - 1)) < 1e-9
    r2 = event_returns(stock, bench, d0 + timedelta(days=2), before_open=True)
    assert abs(r2["reaction"] - 0.10) < 1e-9


def test_abnormal_return_subtracts_benchmark() -> None:
    d0 = date(2026, 1, 1)
    stock = series(d0, [100 * 1.01**i for i in range(90)])
    bench = series(d0, [100 * 1.01**i for i in range(90)])
    r = event_returns(stock, bench, d0 + timedelta(days=5), before_open=False)
    assert abs(r["drift60"]) < 1e-12


def test_not_enough_history() -> None:
    d0 = date(2026, 1, 1)
    r = event_returns(series(d0, [100.0] * 30), series(d0, [100.0] * 30), d0 + timedelta(days=5), before_open=False)
    assert r["reaction"] is not None and r["drift60"] is None


def test_summary_finds_a_planted_effect() -> None:
    ev = []
    for i in range(90):
        v = i / 90
        ev.append(
            {
                "signal": "eps_surprise",
                "ticker": f"T{i % 9}",
                "value": v,
                "reaction": v / 10,
                "drift20": 0.05 * v - 0.025 + (0.002 if i % 2 else -0.002),
                "drift60": 0.0 + (0.01 if i % 2 else -0.01),
            }
        )
    s = summarize(ev)["eps_surprise"]
    assert s["drift20"]["significant"] and s["drift20"]["spread"] > 0.02
    assert not s["drift60"]["significant"]
    assert verdict(s) == "edge"
    assert summarize([])["risk_added"]["drift20"]["enough"] is False
    assert verdict(summarize([])["risk_added"]) == "not_enough_data"


def test_stats_helpers() -> None:
    assert bootstrap_spread([1.0] * 4, [0.0] * 10) is None
    lo, hi = bootstrap_spread([1.0] * 10, [0.0] * 10) or (0, 0)
    assert lo == hi == 1.0
    assert abs((spearman(list(range(10)), [x * 2 for x in range(10)]) or 0) - 1) < 1e-12


def test_cases_math() -> None:
    from ei.filings.cases import forward_pe_history, percentile, split_adjusted_closes, value_facts

    rows = [
        {"date": "2026-01-02", "close": 400.0, "split_factor": 1.0},
        {"date": "2026-01-05", "close": 100.0, "split_factor": 4.0},
    ]
    _d, p = split_adjusted_closes(rows)
    assert p == [100.0, 100.0]  # pre-split price restated on today's share count
    assert percentile([1, 2, 3, 4, 5], 0.5) == 3 and abs(percentile([0, 10], 0.2) - 2) < 1e-12
    q = {date(2022, 3, 31) + timedelta(days=91 * i): 0.5 for i in range(24)}  # $2.00 per 4 quarters
    dates = [date(2022, 1, 1) + timedelta(days=i) for i in range(1600)]
    pes = forward_pe_history(q, (dates, [50.0] * len(dates)), date(2026, 1, 15))
    assert len(pes) >= 30 and all(abs(x - 25.0) < 1e-9 for x in pes)
    n = {
        "price": 100.0,
        "price_date": "2026-11-06",
        "eps": {"eps_low": 4.0, "eps_avg": 5.0, "eps_high": 6.0},
        "analysts": 30,
        "pe": {"p20": 15.0, "p50": 20.0, "p80": 25.0},
        "pe_samples": 60,
        "scenarios": {
            "bear": {"eps": 4.0, "pe": 15.0, "value": 60.0, "vs_price": -0.4},
            "base": {"eps": 5.0, "pe": 20.0, "value": 100.0, "vs_price": 0.0},
            "bull": {"eps": 6.0, "pe": 25.0, "value": 150.0, "vs_price": 0.5},
        },
    }
    texts = [f["text"] for f in value_facts(n, "XYZ")]
    assert "Bear scenario value: low EPS $4.00 × 20th-percentile P/E 15.0x = $60.00 (−40.0% vs. today's price)" in texts
    assert any("+50.0%" in t for t in texts)
