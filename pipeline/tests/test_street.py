from __future__ import annotations

from datetime import date

import pytest

from ei.street import ltm_adjusted_eps, ntm_eps, run_rate_adjusted_eps, street_multiples


def ev(fy: int, fq: int, rd: str, pe: str, eps: float) -> dict[str, object]:
    return {"fiscal_year": fy, "fiscal_quarter": fq, "report_date": rd, "period_end": pe, "eps_reported": eps}


EVENTS = [
    ev(2026, 4, "2026-11-02", "2026-09-30", 2.05),
    ev(2026, 3, "2026-07-30", "2026-06-30", 2.02),
    ev(2026, 2, "2026-04-30", "2026-03-31", 2.01),
    ev(2026, 1, "2026-01-29", "2025-12-31", 2.84),
    ev(2025, 4, "2025-10-30", "2025-09-30", 1.85),
]


def test_ltm_and_run_rate() -> None:
    ltm, qs = ltm_adjusted_eps(EVENTS)
    assert ltm == pytest.approx(2.05 + 2.02 + 2.01 + 2.84)
    assert qs[0] == "FY2026Q4" and len(qs) == 4
    rr, q = run_rate_adjusted_eps(EVENTS)
    assert rr == pytest.approx(8.2) and q == "FY2026Q4"


def test_ntm_prefers_four_quarters_then_blends_years() -> None:
    q = [{"horizon": "fiscal quarter", "period_end": f"2027-{m:02d}-28", "eps_avg": 2.0} for m in (3, 6, 9, 12)]
    eps, how = ntm_eps(q, date(2026, 9, 30), date(2026, 11, 7))
    assert eps == pytest.approx(8.0) and how.startswith("Sum of next 4")
    years = [
        {"horizon": "fiscal year", "period_end": "2027-09-30", "eps_avg": 9.4485},
        {"horizon": "fiscal year", "period_end": "2028-09-30", "eps_avg": 10.8295},
        {"horizon": "fiscal quarter", "period_end": "2026-12-31", "eps_avg": 2.9},
    ]
    eps2, how2 = ntm_eps(years, date(2026, 9, 30), date(2026, 11, 7))
    # Just after fiscal year-end all four FY1 quarters are still ahead, so NTM = FY1 consensus.
    assert eps2 == pytest.approx(9.4485)
    assert "fiscal year ending 2027-09-30" in how2


def test_street_multiples() -> None:
    m = street_multiples(200.0, EVENTS, [], date(2026, 11, 7))
    assert m["pe_adj_ltm"] == pytest.approx(200 / 8.92)
    assert m["pe_adj_run_rate"] == pytest.approx(200 / 8.2)
    assert m["pe_fwd_ntm"] is None


def test_ntm_nvda_partial_quarters() -> None:
    """NVDA Nov 2026: reported through 2026-07-31; two FY2027 quarters left (2.47, 2.75), FY2028 = 15.91."""
    from datetime import date

    from ei.street import ntm_eps

    est = [
        {"horizon": "fiscal quarter", "period_end": "2026-10-31", "eps_avg": 2.47},
        {"horizon": "fiscal quarter", "period_end": "2027-01-31", "eps_avg": 2.75},
        {"horizon": "fiscal year", "period_end": "2027-01-31", "eps_avg": 9.31},
        {"horizon": "fiscal year", "period_end": "2028-01-31", "eps_avg": 15.91},
    ]
    eps, method = ntm_eps(est, date(2026, 7, 31), date(2026, 11, 7))
    assert eps is not None
    assert abs(eps - (2.47 + 2.75 + 15.91 / 2)) < 1e-9
    assert "remaining quarterly" in method
