"""Debt maturity ladder, average interest rate and unused credit lines, from SEC XBRL (free, no AI).

Totals (total debt, cash, net debt, interest expense) are already in metric_values; this adds what
FactSet's capital-structure screen shows on top: when the debt comes due, what it costs, and how much
backup credit is available. Values come from the latest 10-K (maturity schedules are annual disclosures).
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from ei.db import Db
from ei.sec import SecClient

log = logging.getLogger(__name__)

LADDER = [
    ("Next 12 months", ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"]),
    ("Year 2", ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"]),
    ("Year 3", ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"]),
    ("Year 4", ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"]),
    ("Year 5", ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"]),
    ("After year 5", ["LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"]),
]
RATE_TAGS = [
    "LongTermDebtWeightedAverageInterestRate",
    "DebtWeightedAverageInterestRate",
    "DebtInstrumentInterestRateEffectivePercentage",
]
CREDIT_TAGS = {
    "capacity": ["LineOfCreditFacilityMaximumBorrowingCapacity"],
    "available": ["LineOfCreditFacilityRemainingBorrowingCapacity"],
    "drawn": ["LineOfCredit", "LongTermLineOfCredit"],
}


def _facts(cf: dict[str, Any], tag: str, unit: str) -> list[dict[str, Any]]:
    node = (cf.get("facts", {}).get("us-gaap", {}) or {}).get(tag)
    return list((node or {}).get("units", {}).get(unit, [])) if node else []


def _latest_annual(cf: dict[str, Any], tags: list[str], unit: str = "USD") -> tuple[float, str, str] | None:
    """(value, as-of date, accession) from the most recent 10-K that reports any of `tags`."""
    best: tuple[float, str, str, str] | None = None
    for t in tags:
        for f in _facts(cf, t, unit):
            if f.get("form") not in ("10-K", "10-K/A", "20-F", "40-F") or "end" not in f:
                continue
            key = (f["end"], f.get("filed", ""))
            if best is None or key > (best[1], best[3]):
                best = (float(f["val"]), f["end"], f.get("accn", ""), f.get("filed", ""))
    return (best[0], best[1], best[2]) if best else None


def profile(cf: dict[str, Any]) -> dict[str, Any] | None:
    rungs = []
    as_of = None
    for label, tags in LADDER:
        v = _latest_annual(cf, tags)
        rungs.append({"label": label, "value": v[0] if v else None})
        if v:
            as_of = max(as_of or v[1], v[1])
    # keep only rungs from the latest fiscal year end (an old schedule must not mix with a new one)
    if as_of:
        for (label, tags), r in zip(LADDER, rungs, strict=True):
            v = _latest_annual(cf, tags)
            if v and v[1] != as_of:
                r["value"] = None
    rate = _latest_annual(cf, RATE_TAGS, "pure")
    credit = {k: (_latest_annual(cf, t) or (None, None, None))[0] for k, t in CREDIT_TAGS.items()}
    if not as_of and rate is None and not any(credit.values()):
        return None
    # rates are tagged as fractions (0.045) by most filers but as percents (4.5) by a few
    r = rate[0] if rate else None
    if r is not None and r > 1:
        r /= 100
    return {
        "as_of": as_of,
        "ladder": rungs if as_of else [],
        "avg_rate": r if r is not None and 0 < r < 0.3 else None,
        "credit": credit,
    }


def run(db: Db, sec: SecClient, tickers: list[str] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for c in db.select("companies", {"select": "cik,ticker"}):
        if tickers and c["ticker"] not in tickers:
            continue
        try:
            p = profile(sec.companyfacts(c["cik"]))
        except Exception as exc:
            out[c["ticker"]] = f"error: {exc}"[:120]
            continue
        if p:
            db.upsert(
                "debt_profile",
                [
                    {
                        "cik": c["cik"],
                        "as_of": p["as_of"] or date.today().isoformat(),
                        "result": p,
                        "created_at": datetime.now().isoformat(),
                    }
                ],
                on_conflict="cik",
            )
        out[c["ticker"]] = "ok" if p and p["ladder"] else ("partial" if p else "none")
    return out
