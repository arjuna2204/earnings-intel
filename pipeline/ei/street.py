"""Street (adjusted) EPS and consensus estimates, and the P/E multiples built from them.

Source: Alpha Vantage EARNINGS (reported EPS on the basis companies report to analysts, i.e. usually
adjusted/non-GAAP) and EARNINGS_ESTIMATES (consensus). These are NOT from SEC filings; the UI says so.
All arithmetic here is plain code.
"""

from __future__ import annotations

from datetime import date
from typing import Any


def ltm_adjusted_eps(events: list[dict[str, Any]]) -> tuple[float | None, list[str]]:
    """Sum of the last four reported quarters' EPS. Returns (eps, the quarters used)."""
    rows = sorted(
        (e for e in events if e.get("eps_reported") is not None), key=lambda e: e["report_date"], reverse=True
    )[:4]
    if len(rows) < 4:
        return None, []
    return float(sum(r["eps_reported"] for r in rows)), [f"FY{r['fiscal_year']}Q{r['fiscal_quarter']}" for r in rows]


def run_rate_adjusted_eps(events: list[dict[str, Any]]) -> tuple[float | None, str | None]:
    """Latest reported quarter's EPS x 4."""
    rows = sorted(
        (e for e in events if e.get("eps_reported") is not None), key=lambda e: e["report_date"], reverse=True
    )
    if not rows:
        return None, None
    r = rows[0]
    return float(r["eps_reported"]) * 4, f"FY{r['fiscal_year']}Q{r['fiscal_quarter']}"


def ntm_eps(estimates: list[dict[str, Any]], last_reported_end: date | None, today: date) -> tuple[float | None, str]:
    """Next-twelve-months consensus EPS.

    Preferred: sum of the next four quarterly estimates after the last reported quarter.
    Fallback: time-weighted blend of the current and next fiscal-year estimates
    (weight on the current year = share of it still ahead of today)."""
    after = last_reported_end or today
    quarters = sorted(
        (
            e
            for e in estimates
            if e["horizon"] == "fiscal quarter"
            and e.get("eps_avg") is not None
            and date.fromisoformat(str(e["period_end"])) > after
        ),
        key=lambda e: str(e["period_end"]),
    )
    if len(quarters) >= 4:
        q4 = quarters[:4]
        return float(
            sum(e["eps_avg"] for e in q4)
        ), f"Sum of next 4 quarterly consensus estimates ({q4[0]['period_end']} to {q4[-1]['period_end']})"
    years = sorted(
        (
            e
            for e in estimates
            if e["horizon"] == "fiscal year"
            and e.get("eps_avg") is not None
            and date.fromisoformat(str(e["period_end"])) > today
        ),
        key=lambda e: str(e["period_end"]),
    )
    if len(years) >= 2:
        fy1, fy2 = years[0], years[1]
        end1 = date.fromisoformat(str(fy1["period_end"]))
        w1 = min(max((end1 - today).days / 365.25, 0.0), 1.0)
        eps = w1 * float(fy1["eps_avg"]) + (1 - w1) * float(fy2["eps_avg"])
        return eps, (
            f"Time-weighted blend of fiscal-year consensus: {w1:.0%} × FY ending {fy1['period_end']} "
            f"(${float(fy1['eps_avg']):.2f}) + {1 - w1:.0%} × FY ending {fy2['period_end']} (${float(fy2['eps_avg']):.2f})"
        )
    return None, "Not enough consensus estimates"


def street_multiples(
    price: float | None, events: list[dict[str, Any]], estimates: list[dict[str, Any]], today: date
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "street_source": "Alpha Vantage (Street/adjusted EPS and analyst consensus; not from SEC filings)"
    }
    if price is None:
        return out
    ltm, ltm_q = ltm_adjusted_eps(events)
    rr, rr_q = run_rate_adjusted_eps(events)
    last = max(
        (date.fromisoformat(str(e["period_end"])) for e in events if e.get("eps_reported") is not None), default=None
    )
    ntm, method = ntm_eps(estimates, last, today)
    out.update(
        {
            "adj_eps_ltm": ltm,
            "adj_eps_ltm_quarters": ltm_q,
            "pe_adj_ltm": price / ltm if ltm and ltm > 0 else None,
            "adj_eps_run_rate": rr,
            "adj_eps_run_rate_quarter": rr_q,
            "pe_adj_run_rate": price / rr if rr and rr > 0 else None,
            "eps_ntm": ntm,
            "eps_ntm_method": method,
            "pe_fwd_ntm": price / ntm if ntm and ntm > 0 else None,
        }
    )
    return out
