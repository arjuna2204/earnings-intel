import math
import random
from datetime import date, timedelta

from ei.risk import beta_corr, compute, earnings_moves, histogram, max_drawdown, piotroski, var_cvar


def _series(rets, start=date(2020, 1, 1), p0=100.0):
    out, p, d = [], p0, start
    out.append((d, p))
    for r in rets:
        d += timedelta(days=1)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        p *= 1 + r
        out.append((d, p))
    return out


def test_max_drawdown():
    s = [(date(2024, 1, i), p) for i, p in enumerate([100, 120, 90, 110, 60, 130], start=1)]
    mdd, peak, trough = max_drawdown(s)
    assert abs(mdd - (60 / 120 - 1)) < 1e-12 and peak == date(2024, 1, 2) and trough == date(2024, 1, 5)


def test_beta_of_levered_series_is_two():
    random.seed(1)
    m = [random.gauss(0, 0.01) for _ in range(300)]
    a = [2 * x for x in m]
    b, c = beta_corr(a, m)
    assert abs(b - 2) < 1e-9 and abs(c - 1) < 1e-9


def test_var_cvar_and_histogram():
    xs = [-0.05] * 5 + [0.0] * 95
    var, cvar = var_cvar(xs)
    assert var == 0.05 and cvar == 0.05
    h = histogram([-0.5, 0.0, 0.5])
    assert h[0][1] == 1 and h[-1][1] == 1 and sum(c for _, c in h) == 3


def test_earnings_move_timing():
    s = [(date(2024, 5, d), p) for d, p in [(1, 100), (2, 110), (3, 99)]]
    pre = earnings_moves(
        s, [{"report_date": "2024-05-02", "report_time": "pre-market", "fiscal_year": 2024, "fiscal_quarter": 2}]
    )
    post = earnings_moves(
        s, [{"report_date": "2024-05-02", "report_time": "post-market", "fiscal_year": 2024, "fiscal_quarter": 2}]
    )
    assert abs(pre[0]["move"] - 0.10) < 1e-4  # before the open: that day's move
    assert abs(post[0]["move"] - (99 / 110 - 1)) < 1e-4  # after the close: next day's move


def test_piotroski_all_pass():
    fy = {
        "total_assets": {2022: 100, 2023: 100, 2024: 100},
        "net_income": {2022: 5, 2023: 8, 2024: 10},
        "operating_cash_flow": {2024: 12},
        "total_debt": {2023: 30, 2024: 20},
        "current_ratio": {2023: 1.0, 2024: 1.2},
        "diluted_shares": {2023: 10, 2024: 10},
        "gross_margin": {2023: 0.4, 2024: 0.45},
        "revenue": {2023: 80, 2024: 90},
    }
    p = piotroski(fy)
    assert p["score"] == 9 and p["out_of"] == 9 and p["fiscal_year"] == 2024


def test_compute_smoke():
    random.seed(2)
    m = [random.gauss(0.0004, 0.01) for _ in range(800)]
    a = [1.5 * x + random.gauss(0, 0.005) for x in m]
    res = compute(_series(a), _series(m), None, [], {})
    assert 1.3 < res["beta"]["y1"] < 1.7
    assert res["volatility"]["y1"] > res["volatility"]["market_y1"]
    assert -1 < res["drawdown"]["y5"]["max"] <= 0
    assert math.isfinite(res["sharpe"]["y1"])
