"""Turn SEC companyfacts JSON into per-fiscal-period values for each standard metric.

Key rules (all done in code, never by AI):
* Periods are labeled with the COMPANY'S fiscal calendar (fiscal year + Q1..Q4/FY), computed from
  the period end date and the fiscal-year-end month/day. The `fy`/`fp` fields on SEC facts describe
  the *filing*, not the fact's own period, so they are not used for labeling.
* If a period is reported more than once (e.g. restated in a later filing), the latest filing wins.
* Cash-flow items are often reported only year-to-date in 10-Qs; discrete quarters are derived by
  subtraction (Q2 = 6M - Q1, Q3 = 9M - 6M) and Q4 = FY - 9M. Derived values are labeled as such.
"""

from __future__ import annotations

import calendar
from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Any

from ei.xbrl.mapping import BY_NAME, DEI_SHARES_TAG, REPORTED, MetricDef

# Duration length windows (days) used to classify a fact's period.
QUARTER_DAYS = (80, 100)
HALF_DAYS = (170, 195)
NINE_MONTH_DAYS = (260, 285)
YEAR_DAYS = (340, 380)

# Only financial reports. Proxy statements (DEF 14A) and others carry rounded figures
# (e.g. pay-versus-performance tables) that must never override the statements.
FINANCIAL_FORMS = {"10-K", "10-Q", "20-F", "40-F", "6-K", "10-KT", "10-QT", "8-K"}


def _is_financial_form(form: str) -> bool:
    return form.removesuffix("/A") in FINANCIAL_FORMS


@dataclass(frozen=True)
class Fact:
    tag: str
    start: date | None
    end: date
    value: float
    unit: str
    accession: str
    form: str
    filed: date


@dataclass(frozen=True)
class PeriodValue:
    metric: str
    fiscal_year: int
    fiscal_period: str  # 'FY' | 'Q1'..'Q4'
    period_start: date | None
    period_end: date
    value: float
    unit: str
    source: str  # 'reported' | 'derived'
    xbrl_tag: str | None
    accession: str | None
    filed: date | None
    derivation: str | None = None


@dataclass
class NormalizedCompany:
    values: dict[tuple[str, int, str], PeriodValue] = field(default_factory=dict)
    unresolved: dict[str, str] = field(default_factory=dict)
    currency: str = "USD"
    fiscal_year_end: str | None = None
    shares_outstanding_cover: tuple[date, float, str] | None = None  # (as-of, shares, accession)

    def get(self, metric: str, fy: int, fp: str) -> PeriodValue | None:
        return self.values.get((metric, fy, fp))

    def put(self, pv: PeriodValue) -> None:
        self.values[(pv.metric, pv.fiscal_year, pv.fiscal_period)] = pv


def _d(s: str) -> date:
    return date.fromisoformat(s)


# ---------------------------------------------------------------- fiscal calendar


@dataclass(frozen=True)
class FiscalCalendar:
    month: int
    day: int

    @classmethod
    def from_mmdd(cls, mmdd: str) -> FiscalCalendar:
        return cls(int(mmdd[:2]), int(mmdd[2:]))

    def _fye_in(self, year: int) -> date:
        last = calendar.monthrange(year, self.month)[1]
        return date(year, self.month, min(self.day, last))

    def label(self, end: date) -> tuple[int, int]:
        """Return (fiscal_year, quarter 1..4) for a period ending on `end`.

        Tolerates 52/53-week years (period ends can drift ~a week from the nominal date).
        Fiscal year = calendar year in which the fiscal year ends, except years that end in the
        first days of January, which belong to the prior year (e.g. FYE 2025-01-03 -> FY2024).
        """
        fye = next(
            self._fye_in(y)
            for y in (end.year - 1, end.year, end.year + 1)
            if self._fye_in(y) >= end - timedelta(days=10)
        )
        fiscal_year = fye.year - 1 if (fye.month == 1 and fye.day <= 10) else fye.year
        months_before = round((fye - end).days / 30.44)
        quarter = max(1, min(4, 4 - round(months_before / 3)))
        return fiscal_year, quarter

    def is_quarter_end(self, end: date, tolerance_days: int = 12) -> bool:
        """True if `end` falls within a couple of weeks of a fiscal quarter end."""
        fye = next(
            self._fye_in(y)
            for y in (end.year - 1, end.year, end.year + 1)
            if self._fye_in(y) >= end - timedelta(days=10)
        )
        gap = (fye - end).days
        return any(abs(gap - k * 30.44 * 3) <= tolerance_days + k * 2 for k in range(4))


def infer_fiscal_year_end(facts: list[Fact]) -> str | None:
    """Most common month/day among ~1-year duration periods (fallback if SEC lacks it)."""
    ends = [f.end for f in facts if f.start and YEAR_DAYS[0] <= (f.end - f.start).days <= YEAR_DAYS[1]]
    if not ends:
        return None
    month = Counter(e.month for e in ends).most_common(1)[0][0]
    day = max(e.day for e in ends if e.month == month)
    return f"{month:02d}{day:02d}"


# ---------------------------------------------------------------- fact extraction


def _pick_unit(units: dict[str, list[Any]], kind: str, currency: str | None) -> str | None:
    keys = list(units)
    if kind == "shares":
        return "shares" if "shares" in units else None
    if kind == "per_share":
        per = [k for k in keys if k.endswith("/shares")]
        if currency and f"{currency}/shares" in per:
            return f"{currency}/shares"
        return per[0] if per else None
    money = [k for k in keys if len(k) == 3 and k.isupper()]
    if currency and currency in money:
        return currency
    if "USD" in money:
        return "USD"
    return max(money, key=lambda k: len(units[k])) if money else None


def extract_facts(companyfacts: dict[str, Any], tag: str, taxonomy: str, kind: str, currency: str | None) -> list[Fact]:
    node = companyfacts.get("facts", {}).get(taxonomy, {}).get(tag)
    if not node:
        return []
    unit = _pick_unit(node.get("units", {}), kind, currency)
    if unit is None:
        return []
    out = []
    for f in node["units"][unit]:
        if "end" not in f or "val" not in f or not _is_financial_form(f.get("form", "")):
            continue
        out.append(
            Fact(
                tag=f"{taxonomy}:{tag}",
                start=_d(f["start"]) if f.get("start") else None,
                end=_d(f["end"]),
                value=float(f["val"]),
                unit=unit,
                accession=f.get("accn", ""),
                form=f.get("form", ""),
                filed=_d(f["filed"]) if f.get("filed") else date.min,
            )
        )
    return out


def detect_currency(companyfacts: dict[str, Any]) -> str:
    """Reporting currency = currency unit used by the revenue / assets tags."""
    for tax, tag in (
        ("us-gaap", "Assets"),
        ("ifrs-full", "Assets"),
        ("us-gaap", "Revenues"),
        ("ifrs-full", "Revenue"),
    ):
        node = companyfacts.get("facts", {}).get(tax, {}).get(tag)
        if node:
            money: list[str] = [str(k) for k in node.get("units", {}) if len(k) == 3 and k.isupper()]
            if money:
                return str(max(money, key=lambda k: len(node["units"][k])))
    return "USD"


def _latest_by_period(facts: list[Fact]) -> dict[tuple[date | None, date], Fact]:
    best: dict[tuple[date | None, date], Fact] = {}
    for f in facts:
        key = (f.start, f.end)
        cur = best.get(key)
        if cur is None or (f.filed, f.accession) > (cur.filed, cur.accession):
            best[key] = f
    return best


def _classify(f: Fact) -> str:
    if f.start is None:
        return "I"
    days = (f.end - f.start).days
    for name, (lo, hi) in (
        ("Q", QUARTER_DAYS),
        ("H", HALF_DAYS),
        ("N", NINE_MONTH_DAYS),
        ("Y", YEAR_DAYS),
    ):
        if lo <= days <= hi:
            return name
    return "?"


# ---------------------------------------------------------------- normalization


def _candidates(m: MetricDef) -> list[tuple[str, str]]:
    return [("us-gaap", t) for t in m.us_gaap] + [("ifrs-full", t) for t in m.ifrs]


def _collect(companyfacts: dict[str, Any], m: MetricDef, currency: str) -> dict[tuple[date | None, date], Fact]:
    """Per period, the value from the highest-priority candidate tag that reports it."""
    chosen: dict[tuple[date | None, date], Fact] = {}
    for taxonomy, tag in _candidates(m):
        per_period = _latest_by_period(extract_facts(companyfacts, tag, taxonomy, m.unit, currency))
        for key, f in per_period.items():
            chosen.setdefault(key, f)
    return chosen


def _pv(m: MetricDef, fy: int, fp: str, f: Fact) -> PeriodValue:
    return PeriodValue(m.name, fy, fp, f.start, f.end, f.value, f.unit, "reported", f.tag, f.accession, f.filed)


def normalize(
    companyfacts: dict[str, Any],
    fiscal_year_end: str | None,
    pack: str = "general",
    min_fiscal_year: int | None = None,
) -> NormalizedCompany:
    currency = detect_currency(companyfacts)
    out = NormalizedCompany(currency=currency)

    if not fiscal_year_end:
        rev = _collect(companyfacts, BY_NAME["revenue"], currency) or _collect(
            companyfacts, BY_NAME["net_income"], currency
        )
        fiscal_year_end = infer_fiscal_year_end(list(rev.values()))
    out.fiscal_year_end = fiscal_year_end
    if not fiscal_year_end:
        out.unresolved["*"] = "Could not determine the company's fiscal year end"
        return out
    cal = FiscalCalendar.from_mmdd(fiscal_year_end)

    for m in REPORTED:
        if pack not in m.packs:
            continue
        facts = _collect(companyfacts, m, currency)
        if not facts:
            if not m.internal:
                out.unresolved[m.name] = "No matching XBRL tag found in this company's filings"
            continue
        if m.kind == "instant":
            _place_instants(out, m, facts.values(), cal)
        else:
            _place_durations(out, m, facts.values(), cal)

    if min_fiscal_year is not None:
        out.values = {k: v for k, v in out.values.items() if v.fiscal_year >= min_fiscal_year}

    _cover_shares(companyfacts, out)
    return out


def _place_instants(out: NormalizedCompany, m: MetricDef, facts: Any, cal: FiscalCalendar) -> None:
    for f in facts:
        if not cal.is_quarter_end(f.end):
            continue  # e.g. an acquisition-date balance; not a reporting period
        fy, q = cal.label(f.end)
        if q == 4:
            # Year-end balance sheet belongs to both FY and Q4.
            out.put(_pv(m, fy, "FY", f))
            out.put(_pv(m, fy, "Q4", f))
        else:
            out.put(_pv(m, fy, f"Q{q}", f))


def _place_durations(out: NormalizedCompany, m: MetricDef, facts: Any, cal: FiscalCalendar) -> None:
    quarters: dict[tuple[int, int], Fact] = {}
    ytd: dict[tuple[int, int], Fact] = {}  # (fy, 2|3) -> 6M / 9M facts
    annual: dict[int, Fact] = {}
    for f in facts:
        cls = _classify(f)
        fy, q = cal.label(f.end)
        if cls == "Q":
            quarters[(fy, q)] = f
        elif cls == "H" and q == 2:
            ytd[(fy, 2)] = f
        elif cls == "N" and q == 3:
            ytd[(fy, 3)] = f
        elif cls == "Y" and q == 4:
            annual[fy] = f

    for fy, f in annual.items():
        out.put(_pv(m, fy, "FY", f))
    for (fy, q), f in quarters.items():
        out.put(_pv(m, fy, f"Q{q}", f))

    if not m.additive:
        return
    approx = " (approximate: per-share figures don't strictly add across quarters)" if m.approx_when_derived else ""
    years = {fy for fy, _ in quarters} | {fy for fy, _ in ytd} | set(annual)
    for fy in sorted(years):
        q1 = out.get(m.name, fy, "Q1")
        # Q2 from 6M YTD
        if out.get(m.name, fy, "Q2") is None and q1 and (fy, 2) in ytd:
            h = ytd[(fy, 2)]
            out.put(_derived(m, fy, "Q2", h, h.value - q1.value, f"6-month YTD minus Q1{approx}", q1.period_end))
        q2 = out.get(m.name, fy, "Q2")
        # Q3 from 9M YTD
        if out.get(m.name, fy, "Q3") is None and (fy, 3) in ytd:
            n = ytd[(fy, 3)]
            if (fy, 2) in ytd:
                h = ytd[(fy, 2)]
                out.put(_derived(m, fy, "Q3", n, n.value - h.value, f"9-month YTD minus 6-month YTD{approx}", h.end))
            elif q1 and q2:
                out.put(
                    _derived(
                        m,
                        fy,
                        "Q3",
                        n,
                        n.value - q1.value - q2.value,
                        f"9-month YTD minus Q1 and Q2{approx}",
                        q2.period_end,
                    )
                )
        q3 = out.get(m.name, fy, "Q3")
        # Q4 from FY. Prefer FY minus the three quarters we actually show, so the four quarters always
        # add up to the year; flag when the full year was restated after those quarters were filed.
        if out.get(m.name, fy, "Q4") is None and fy in annual:
            a = annual[fy]
            if q1 and q2 and q3:
                how = f"Full year minus Q1–Q3{approx}"
                if (fy, 3) in ytd:
                    via_ytd = a.value - ytd[(fy, 3)].value
                    via_q = a.value - q1.value - q2.value - q3.value
                    if abs(via_ytd - via_q) > 0.005 * max(abs(a.value), 1.0):
                        how += " (full year was restated after Q1–Q3 were filed; Q4 absorbs the difference)"
                out.put(_derived(m, fy, "Q4", a, a.value - q1.value - q2.value - q3.value, how, q3.period_end))
            elif (fy, 3) in ytd:
                n = ytd[(fy, 3)]
                out.put(_derived(m, fy, "Q4", a, a.value - n.value, f"Full year minus 9-month YTD{approx}", n.end))


def _derived(m: MetricDef, fy: int, fp: str, src: Fact, value: float, how: str, prev_end: date | None) -> PeriodValue:
    start = prev_end + timedelta(days=1) if prev_end else None
    return PeriodValue(
        m.name, fy, fp, start, src.end, value, src.unit, "derived", src.tag, src.accession, src.filed, how
    )


def _cover_shares(companyfacts: dict[str, Any], out: NormalizedCompany) -> None:
    """Latest cover-page share count, summed across share classes reported for the same date."""
    node = companyfacts.get("facts", {}).get("dei", {}).get(DEI_SHARES_TAG)
    if not node or "shares" not in node.get("units", {}):
        return
    rows = node["units"]["shares"]
    if not rows:
        return
    latest_end = max(r["end"] for r in rows)
    same = [r for r in rows if r["end"] == latest_end]
    latest_filed = max(r.get("filed", "") for r in same)
    final = [r for r in same if r.get("filed", "") == latest_filed]
    out.shares_outstanding_cover = (
        _d(latest_end),
        float(sum(r["val"] for r in final)),
        final[0].get("accn", ""),
    )


__all__ = ["Fact", "FiscalCalendar", "NormalizedCompany", "PeriodValue", "normalize", "replace"]
