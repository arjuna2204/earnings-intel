"""DCF math (no network)."""

from __future__ import annotations

from ei.dcf import build, nwc, sensitivity


def assumptions(**kw: float) -> dict[str, float]:
    a = {f"growth_{t}": 0.10 for t in range(1, 6)} | {f"margin_{t}": 0.20 for t in range(1, 6)}
    a |= {"tax_rate": 0.25, "da_pct": 0.05, "capex_pct": 0.05, "nwc_pct": 0.0, "wacc": 0.10, "terminal_growth": 0.02, "net_debt": 100.0, "shares": 10.0, "price": 50.0}
    return a | kw


def test_fcf_and_value_by_hand() -> None:
    hist = [{"revenue": 1000.0}]
    r = build(hist, assumptions())
    y1 = r["rows"][0]
    assert abs(y1["revenue"] - 1100) < 1e-9
    assert abs(y1["fcf"] - 1100 * 0.20 * 0.75) < 1e-9  # D&A = capex, no working capital
    fcfs = [1000 * 1.1**t * 0.15 for t in range(1, 6)]
    pv = sum(f / 1.1**t for t, f in enumerate(fcfs, 1))
    tv = fcfs[-1] * 1.02 / 0.08
    ev = pv + tv / 1.1**5
    assert abs(r["enterprise_value"] - ev) < 1e-6
    assert abs(r["per_share"] - (ev - 100) / 10) < 1e-9
    assert abs(r["upside"] - ((ev - 100) / 10 / 50 - 1)) < 1e-9


def test_working_capital_reduces_fcf() -> None:
    hist = [{"revenue": 1000.0}]
    assert build(hist, assumptions(nwc_pct=0.2))["rows"][0]["fcf"] < build(hist, assumptions())["rows"][0]["fcf"]
    assert nwc({"current_assets": 500, "cash": 200, "current_liabilities": 250, "debt_short": 50}) == 100


def test_sensitivity_moves_the_right_way() -> None:
    s = sensitivity([{"revenue": 1000.0}], assumptions())
    grid = s["values"]
    assert grid[0][2] > grid[4][2]  # lower WACC -> higher value
    assert grid[2][4] > grid[2][0]  # higher terminal growth -> higher value
    assert abs(grid[2][2] - build([{"revenue": 1000.0}], assumptions())["per_share"]) < 1e-9
