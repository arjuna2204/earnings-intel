from datetime import date

from ei.quality import check_company

TODAY = date(2026, 11, 9)


def checks(**kw):  # type: ignore[no-untyped-def]
    args = {
        "v": {},
        "m": {},
        "quarters": [],
        "segments": {},
        "dcf_per_share": None,
        "last_price": TODAY,
        "today": TODAY,
    }
    args.update(kw)
    return {f["check"]: f for f in check_company(**args)}


def test_clean_company_has_no_flags() -> None:
    v = {"price": 100.0, "market_cap": 1e11, "pe": 20.0, "dividend_yield": 0.01}
    m = {"net_income_ttm": 5e9, "eps_diluted_ttm": 5.0, "diluted_shares": 1e9}
    assert checks(v=v, m=m, dcf_per_share=110.0) == {}


def test_one_share_class_market_value_is_hidden() -> None:
    # Visa-like: cover page lists a quarter of the shares
    v = {"price": 400.0, "market_cap": 2e11, "pe": 32.0}
    m = {"net_income_ttm": 25e9, "eps_diluted_ttm": 12.5, "diluted_shares": 2e9}
    f = checks(v=v, m=m)
    assert f["market_value"]["severity"] == "hide" and "market_cap" in f["market_value"]["fields"]


def test_dividend_mismatch_and_negative_quarter_and_dcf() -> None:
    v = {"price": 50.0, "dividend_per_share_ttm": 0.5, "dividend_yield": 0.01}
    m = {"dividends_paid_ttm": 5e9, "diluted_shares": 1e9}
    f = checks(v=v, m=m, quarters=[("Q4 FY2025", -1e9)], dcf_per_share=500.0)
    assert f["dividends"]["severity"] == "hide"
    assert f["revenue_quarter"]["severity"] == "warn"
    assert f["dcf"]["severity"] == "hide"


def test_segments_double_count_and_stale_price() -> None:
    f = checks(segments={"product": (270e9, 95e9)}, last_price=date(2026, 10, 1))
    assert f["segments"]["fields"] == ["segments:product"]
    assert f["price_stale"]["severity"] == "warn"
