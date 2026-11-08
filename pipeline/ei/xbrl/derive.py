"""Derived metrics, computed in code from normalized reported values.

Conventions
* Ratios that mix a flow (income/cash flow) with a balance use, for each period, the FY value for
  'FY' periods and the trailing-twelve-month (TTM) value for quarters, over the AVERAGE of the
  balance at period end and one year earlier.
* TTM values are stored as `<metric>_ttm` on each quarter where four consecutive quarters exist.
* Anything that can't be computed is simply absent ("Not reported" in the UI); nothing is guessed.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from ei.xbrl.mapping import BY_NAME, NOT_IN_XBRL
from ei.xbrl.normalize import NormalizedCompany, PeriodValue

PERIODS = ("Q1", "Q2", "Q3", "Q4")
TTM_FLOWS = (
    "revenue",
    "cost_of_revenue",
    "gross_profit",
    "operating_income",
    "pretax_income",
    "income_tax",
    "net_income",
    "eps_diluted",
    "da",
    "operating_cash_flow",
    "capex",
    "ebitda",
    "free_cash_flow",
    "net_interest_income",
    "noninterest_income",
    "noninterest_expense",
    "net_chargeoffs",
    "premiums_earned",
    "losses_incurred",
)
DEFAULT_TAX_RATE = 0.21


def _prev_quarter(fy: int, fp: str) -> tuple[int, str]:
    q = int(fp[1])
    return (fy, f"Q{q - 1}") if q > 1 else (fy - 1, "Q4")


def _periods(nc: NormalizedCompany) -> list[tuple[int, str]]:
    return sorted({(fy, fp) for (_, fy, fp) in nc.values})


@dataclass
class Ctx:
    nc: NormalizedCompany

    def v(self, metric: str, fy: int, fp: str) -> float | None:
        pv = self.nc.get(metric, fy, fp)
        return pv.value if pv else None

    def anchor(self, fy: int, fp: str) -> PeriodValue | None:
        """Any reported value for this period, used to carry dates/filing onto derived rows."""
        for name in ("revenue", "net_income", "total_assets", "operating_income", "total_equity"):
            pv = self.nc.get(name, fy, fp)
            if pv:
                return pv
        return next((pv for (_, y, p), pv in self.nc.values.items() if y == fy and p == fp), None)

    def put(self, metric: str, fy: int, fp: str, value: float | None, unit: str, how: str) -> None:
        if value is None or value != value:  # None or NaN
            return
        a = self.anchor(fy, fp)
        if a is None:
            return
        self.nc.put(
            PeriodValue(
                metric,
                fy,
                fp,
                a.period_start,
                a.period_end,
                value,
                unit,
                "derived",
                None,
                a.accession,
                a.filed,
                how,
            )
        )

    def flow_basis(self, metric: str, fy: int, fp: str) -> float | None:
        """FY value for FY periods; TTM value for quarters."""
        return self.v(metric, fy, "FY") if fp == "FY" else self.v(f"{metric}_ttm", fy, fp)

    def avg_balance(self, metric: str, fy: int, fp: str) -> float | None:
        end = self.v(metric, fy, fp)
        prior = self.v(metric, fy - 1, fp)
        if end is None or prior is None:
            return None
        return (end + prior) / 2


def _div(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


def _sum(*xs: float | None) -> float | None:
    if any(x is None for x in xs):
        return None
    return float(sum(x for x in xs if x is not None))


def _cur(nc: NormalizedCompany) -> str:
    return nc.currency


def derive_all(nc: NormalizedCompany, pack: str) -> NormalizedCompany:
    c = Ctx(nc)
    cur = _cur(nc)
    periods = _periods(nc)

    # 1) Simple same-period derivations (needed before TTM).
    for fy, fp in periods:
        if c.v("gross_profit", fy, fp) is None:
            c.put(
                "gross_profit",
                fy,
                fp,
                _sum(c.v("revenue", fy, fp), _neg(c.v("cost_of_revenue", fy, fp))),
                cur,
                "Revenue − cost of revenue",
            )
        c.put(
            "ebitda",
            fy,
            fp,
            _sum(c.v("operating_income", fy, fp), c.v("da", fy, fp)),
            cur,
            "Operating income + depreciation & amortization",
        )
        c.put(
            "free_cash_flow",
            fy,
            fp,
            _sum(c.v("operating_cash_flow", fy, fp), _neg(c.v("capex", fy, fp))),
            cur,
            "Operating cash flow − capital expenditures",
        )
        debt, how = _total_debt(c, fy, fp)
        c.put("total_debt", fy, fp, debt, cur, how)
        c.put(
            "net_debt",
            fy,
            fp,
            _sum(c.v("total_debt", fy, fp), _neg(c.v("cash", fy, fp))),
            cur,
            "Total debt − cash",
        )

    # 2) TTM for flows.
    for fy, fp in periods:
        if fp == "FY":
            continue
        for m in TTM_FLOWS:
            chain = [(fy, fp)]
            for _ in range(3):
                chain.append(_prev_quarter(*chain[-1]))
            vals = [c.v(m, y, p) for y, p in chain]
            if all(x is not None for x in vals):
                unit = (
                    nc.get(m, fy, fp)
                    or nc.get(m, *chain[1])
                    or PeriodValue(m, fy, fp, None, date.min, 0, cur, "", None, None, None)
                ).unit
                c.put(
                    f"{m}_ttm",
                    fy,
                    fp,
                    float(sum(x for x in vals if x is not None)),
                    unit,
                    "Sum of the last four quarters",
                )

    # 3) Ratios, growth, returns.
    for fy, fp in periods:
        rev = c.v("revenue", fy, fp)
        c.put("gross_margin", fy, fp, _div(c.v("gross_profit", fy, fp), rev), "ratio", "Gross profit ÷ revenue")
        c.put(
            "operating_margin",
            fy,
            fp,
            _div(c.v("operating_income", fy, fp), rev),
            "ratio",
            "Operating income ÷ revenue",
        )
        c.put("net_margin", fy, fp, _div(c.v("net_income", fy, fp), rev), "ratio", "Net income ÷ revenue")
        c.put(
            "fcf_margin",
            fy,
            fp,
            _div(c.v("free_cash_flow", fy, fp), rev),
            "ratio",
            "Free cash flow ÷ revenue",
        )
        c.put("capex_to_revenue", fy, fp, _div(c.v("capex", fy, fp), rev), "ratio", "Capex ÷ revenue")
        c.put(
            "current_ratio",
            fy,
            fp,
            _div(c.v("current_assets", fy, fp), c.v("current_liabilities", fy, fp)),
            "x",
            "Current assets ÷ current liabilities",
        )

        c.put(
            "revenue_growth_yoy",
            fy,
            fp,
            _growth(c.v("revenue", fy, fp), c.v("revenue", fy - 1, fp)),
            "ratio",
            "Revenue vs. same period last year",
        )
        c.put(
            "eps_growth_yoy",
            fy,
            fp,
            _growth(c.v("eps_diluted", fy, fp), c.v("eps_diluted", fy - 1, fp)),
            "ratio",
            "Diluted EPS vs. same period last year (blank when last year's EPS was ≤ 0)",
        )

        basis = "FY" if fp == "FY" else "TTM"
        ni = c.flow_basis("net_income", fy, fp)
        c.put(
            "roe",
            fy,
            fp,
            _div(ni, c.avg_balance("total_equity", fy, fp)),
            "ratio",
            f"Net income ({basis}) ÷ average equity",
        )
        c.put(
            "roa",
            fy,
            fp,
            _div(ni, c.avg_balance("total_assets", fy, fp)),
            "ratio",
            f"Net income ({basis}) ÷ average total assets",
        )

        oi = c.flow_basis("operating_income", fy, fp)
        rate, rate_how = _tax_rate(c, fy, fp)
        ic_now = _sum(c.v("total_debt", fy, fp), c.v("total_equity", fy, fp), _neg(c.v("cash", fy, fp)))
        ic_prior = _sum(c.v("total_debt", fy - 1, fp), c.v("total_equity", fy - 1, fp), _neg(c.v("cash", fy - 1, fp)))
        avg_ic = (ic_now + ic_prior) / 2 if ic_now is not None and ic_prior is not None else None
        if oi is not None and avg_ic and avg_ic > 0:
            c.put(
                "roic",
                fy,
                fp,
                oi * (1 - rate) / avg_ic,
                "ratio",
                f"Operating income ({basis}) × (1 − tax rate {rate:.0%}, {rate_how}) ÷ average (debt + equity − cash)",
            )

        ebitda_b = c.flow_basis("ebitda", fy, fp)
        if ebitda_b and ebitda_b > 0:
            c.put(
                "net_debt_to_ebitda",
                fy,
                fp,
                _div(c.v("net_debt", fy, fp), ebitda_b),
                "x",
                f"Net debt ÷ EBITDA ({basis})",
            )
            c.put(
                "debt_to_ebitda",
                fy,
                fp,
                _div(c.v("total_debt", fy, fp), ebitda_b),
                "x",
                f"Total debt ÷ EBITDA ({basis})",
            )

        rev_b = c.flow_basis("revenue", fy, fp)
        c.put(
            "dso",
            fy,
            fp,
            _mul(_div(c.v("accounts_receivable", fy, fp), rev_b), 365),
            "days",
            f"Accounts receivable ÷ revenue ({basis}) × 365",
        )
        c.put(
            "inventory_turns",
            fy,
            fp,
            _div(c.flow_basis("cost_of_revenue", fy, fp), c.avg_balance("inventory", fy, fp)),
            "x",
            f"Cost of revenue ({basis}) ÷ average inventory",
        )

        if pack == "bank":
            _bank(c, fy, fp, basis)
        elif pack == "insurer":
            _insurer(c, fy, fp)

    for metric, reason in NOT_IN_XBRL.get(pack, {}).items():
        nc.unresolved.setdefault(metric, reason)
    return nc


def _neg(x: float | None) -> float | None:
    return -x if x is not None else None


def _mul(x: float | None, k: float) -> float | None:
    return x * k if x is not None else None


def _growth(now: float | None, prior: float | None) -> float | None:
    if now is None or prior is None or prior <= 0:
        return None
    return now / prior - 1


def _tax_rate(c: Ctx, fy: int, fp: str) -> tuple[float, str]:
    tax = c.flow_basis("income_tax", fy, fp)
    pre = c.flow_basis("pretax_income", fy, fp)
    if tax is not None and pre and pre > 0:
        return min(max(tax / pre, 0.0), 0.35), "effective"
    return DEFAULT_TAX_RATE, "default 21%; effective rate unavailable"


def _total_debt(c: Ctx, fy: int, fp: str) -> tuple[float | None, str]:
    """Total debt, preferring a reported total, then standard components. Leases are excluded
    unless the company only reports debt combined with finance leases (noted in the formula)."""
    combined = c.v("debt_combined_total", fy, fp)
    if combined is not None:
        return combined, "Total debt as reported (long-term + short-term combined)"
    short = c.v("debt_short", fy, fp) or 0.0
    total = c.v("debt_long_total", fy, fp)
    if total is not None:
        return total + short, "Long-term debt (incl. current portion) + short-term borrowings"
    current_total = c.v("debt_current_total", fy, fp)
    nonc = c.v("debt_long_noncurrent", fy, fp)
    if nonc is not None:
        if current_total is not None:
            return nonc + current_total, "Long-term debt (noncurrent) + all debt due within one year"
        return nonc + (c.v("debt_long_current", fy, fp) or 0.0) + short, (
            "Long-term debt (noncurrent + current portion) + short-term borrowings"
        )
    nonc_leases = c.v("debt_noncurrent_incl_leases", fy, fp)
    if nonc_leases is not None:
        return nonc_leases + (current_total or 0.0), (
            "Long-term debt incl. finance leases (noncurrent) + all debt due within one year"
        )
    ifrs = c.v("debt_ifrs_total", fy, fp)
    if ifrs is not None:
        return ifrs, "Total borrowings (IFRS)"
    parts = {
        "notes payable": c.v("debt_notes_payable", fy, fp),
        "secured debt/mortgages": c.v("debt_secured", fy, fp),
        "unsecured debt": c.v("debt_unsecured", fy, fp),
        "line of credit": c.v("debt_line_of_credit", fy, fp),
        "commercial paper/short-term": c.v("debt_short", fy, fp),
    }
    present = {k: v for k, v in parts.items() if v is not None}
    if present and any(k != "commercial paper/short-term" for k in present):
        return float(sum(present.values())), "Sum of reported debt lines: " + ", ".join(present)
    return None, ""


def _bank(c: Ctx, fy: int, fp: str, basis: str) -> None:
    rev_like = _sum(c.v("net_interest_income", fy, fp), c.v("noninterest_income", fy, fp))
    c.put(
        "efficiency_ratio",
        fy,
        fp,
        _div(c.v("noninterest_expense", fy, fp), rev_like),
        "ratio",
        "Noninterest expense ÷ (net interest income + noninterest income)",
    )
    loans_net = c.v("loans_net", fy, fp)
    loans_gross = c.v("loans_gross", fy, fp)
    if loans_gross is None and loans_net is not None and c.v("loan_allowance", fy, fp) is not None:
        loans_gross = loans_net + (c.v("loan_allowance", fy, fp) or 0)
    c.put(
        "loan_to_deposit",
        fy,
        fp,
        _div(loans_net if loans_net is not None else loans_gross, c.v("deposits", fy, fp)),
        "ratio",
        "Loans ÷ deposits",
    )
    c.put(
        "allowance_to_loans",
        fy,
        fp,
        _div(c.v("loan_allowance", fy, fp), loans_gross),
        "ratio",
        "Allowance for credit losses ÷ gross loans",
    )
    avg_loans = c.avg_balance("loans_gross", fy, fp) or c.avg_balance("loans_net", fy, fp)
    c.put(
        "net_chargeoff_ratio",
        fy,
        fp,
        _div(c.flow_basis("net_chargeoffs", fy, fp), avg_loans),
        "ratio",
        f"Net charge-offs ({basis}) ÷ average loans",
    )
    tce_now = _tce(c, fy, fp)
    tce_prior = _tce(c, fy - 1, fp)
    if tce_now is not None and tce_prior is not None:
        c.put(
            "tangible_common_equity",
            fy,
            fp,
            tce_now,
            _cur(c.nc),
            "Equity − preferred − goodwill − intangibles",
        )
        c.put(
            "rotce",
            fy,
            fp,
            _div(c.flow_basis("net_income", fy, fp), (tce_now + tce_prior) / 2),
            "ratio",
            f"Net income ({basis}) ÷ average tangible common equity",
        )


def _tce(c: Ctx, fy: int, fp: str) -> float | None:
    eq = c.v("total_equity", fy, fp)
    if eq is None:
        return None
    return (
        eq - (c.v("preferred_equity", fy, fp) or 0) - (c.v("goodwill", fy, fp) or 0) - (c.v("intangibles", fy, fp) or 0)
    )


def _insurer(c: Ctx, fy: int, fp: str) -> None:
    prem = c.v("premiums_earned", fy, fp)
    loss = _div(c.v("losses_incurred", fy, fp), prem)
    c.put("loss_ratio", fy, fp, loss, "ratio", "Losses incurred ÷ premiums earned")
    dac, other = c.v("dac_amortization", fy, fp), c.v("other_underwriting_expense", fy, fp)
    exp = _div(_sum(dac, other), prem)
    c.put(
        "expense_ratio",
        fy,
        fp,
        exp,
        "ratio",
        "(DAC amortization + other underwriting expense) ÷ premiums earned",
    )
    if loss is not None and exp is not None:
        c.put("combined_ratio", fy, fp, loss + exp, "ratio", "Loss ratio + expense ratio")
    c.put(
        "book_value_per_share",
        fy,
        fp,
        _div(c.v("total_equity", fy, fp), c.v("shares_outstanding_bs", fy, fp)),
        f"{_cur(c.nc)}/shares",
        "Shareholders' equity ÷ shares outstanding",
    )


# ---------------------------------------------------------------- valuation snapshot


def latest_period(nc: NormalizedCompany, metric: str) -> PeriodValue | None:
    rows = [pv for (m, _, fp), pv in nc.values.items() if m == metric and fp != "FY"]
    return max(rows, key=lambda pv: pv.period_end) if rows else None


def valuation_snapshot(
    nc: NormalizedCompany, pack: str, price: float | None, price_date: str | None
) -> dict[str, object]:
    """Current multiples from the latest price and latest reported figures (all code math)."""
    snap: dict[str, object] = {"price": price, "price_date": price_date, "currency": nc.currency}
    if price is None:
        snap["note"] = "No price available"
        return snap
    if nc.currency != "USD":
        snap["note"] = (
            f"Financials are reported in {nc.currency}; USD multiples need FX and ADR ratio and are not computed yet."
        )
        return snap

    def lv(metric: str) -> float | None:
        pv = latest_period(nc, metric)
        return pv.value if pv else None

    shares = nc.shares_outstanding_cover[1] if nc.shares_outstanding_cover else lv("diluted_shares")
    snap["shares_source"] = (
        "Cover page shares outstanding" if nc.shares_outstanding_cover else "Latest diluted weighted shares"
    )
    mcap = price * shares if shares else None
    snap["market_cap"] = mcap
    debt, cash = lv("total_debt"), lv("cash")
    ev = mcap + (debt or 0) - (cash or 0) if mcap is not None else None
    snap["enterprise_value"] = ev
    ebitda, rev, fcf, eps = (
        lv("ebitda_ttm"),
        lv("revenue_ttm"),
        lv("free_cash_flow_ttm"),
        lv("eps_diluted_ttm"),
    )
    snap["pe"] = price / eps if eps and eps > 0 else None
    snap["fcf_yield"] = _div(fcf, mcap)
    if pack == "bank":
        snap["p_tbv"] = _div(mcap, lv("tangible_common_equity"))
    elif pack == "insurer":
        snap["p_b"] = _div(mcap, lv("total_equity"))
    else:
        snap["ev_ebitda"] = _div(ev, ebitda) if ebitda and ebitda > 0 else None
        snap["ev_revenue"] = _div(ev, rev)
    return snap


Deriver = Callable[[NormalizedCompany, str], NormalizedCompany]
__all__ = ["BY_NAME", "derive_all", "valuation_snapshot"]
