from ei.debt import profile


def f(val, end, form="10-K", filed="2026-02-01", accn="a"):  # type: ignore[no-untyped-def]
    return {"val": val, "end": end, "form": form, "filed": filed, "accn": accn}


def test_ladder_from_latest_10k_only() -> None:
    cf = {
        "facts": {
            "us-gaap": {
                "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths": {
                    "units": {"USD": [f(5e9, "2025-12-31"), f(4e9, "2024-12-31")]}
                },
                "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo": {
                    "units": {"USD": [f(3e9, "2024-12-31")]}
                },  # stale: dropped
                "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive": {"units": {"USD": [f(20e9, "2025-12-31")]}},
                "LongTermDebtWeightedAverageInterestRate": {"units": {"pure": [f(4.2, "2025-12-31")]}},
                "LineOfCreditFacilityMaximumBorrowingCapacity": {"units": {"USD": [f(10e9, "2025-12-31")]}},
            }
        }
    }
    p = profile(cf)
    assert p is not None and p["as_of"] == "2025-12-31"
    by = {r["label"]: r["value"] for r in p["ladder"]}
    assert by["Next 12 months"] == 5e9 and by["Year 2"] is None and by["After year 5"] == 20e9
    assert abs(p["avg_rate"] - 0.042) < 1e-9  # percent converted to a fraction
    assert p["credit"]["capacity"] == 10e9


def test_no_debt_data() -> None:
    assert profile({"facts": {"us-gaap": {}}}) is None
