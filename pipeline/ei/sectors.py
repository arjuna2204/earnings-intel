"""Map SEC SIC codes to a metric pack (bank/REIT/insurer/general) and a SPDR sector ETF benchmark."""

from __future__ import annotations

from dataclasses import dataclass

BANK_SIC = {6021, 6022, 6029, 6035, 6036}
REIT_SIC = {6798}
INSURER_SIC = {6311, 6321, 6331, 6351, 6361, 6399}
# Codes where the right pack isn't clear-cut; the app asks Arjun instead of guessing.
AMBIGUOUS_SIC = {
    6324: "Hospital & medical service plans (health insurer): insurer ratios may not fit",
    6411: "Insurance agents/brokers: they don't underwrite, so loss/combined ratios may not apply",
    6199: "Finance services: could be a lender, card network or fintech",
    6770: "Blank check company (SPAC)",
}

# (low, high, etf) ranges, checked in order; first match wins. Specific ranges come before broad ones.
_ETF_RANGES: list[tuple[int, int, str]] = [
    (1311, 1389, "XLE"),
    (2900, 2999, "XLE"),
    (2830, 2836, "XLV"),
    (2840, 2844, "XLP"),
    (3570, 3579, "XLK"),
    (3630, 3639, "XLY"),
    (3651, 3652, "XLY"),
    (3711, 3711, "XLY"),
    (3714, 3714, "XLY"),
    (3720, 3729, "XLI"),
    (3812, 3812, "XLI"),
    (3841, 3851, "XLV"),
    (5400, 5499, "XLP"),
    (5912, 5912, "XLP"),
    (6500, 6553, "XLRE"),
    (6798, 6798, "XLRE"),
    (7310, 7319, "XLC"),
    (7370, 7379, "XLK"),
    (7990, 7999, "XLY"),
    (7800, 7899, "XLC"),
    (100, 999, "XLP"),
    (1000, 1499, "XLB"),
    (1500, 1799, "XLI"),
    (2000, 2199, "XLP"),
    (2200, 2399, "XLY"),
    (2400, 2499, "XLB"),
    (2500, 2599, "XLY"),
    (2600, 2699, "XLB"),
    (2700, 2799, "XLC"),
    (2800, 2899, "XLB"),
    (3000, 3399, "XLB"),
    (3400, 3499, "XLI"),
    (3500, 3599, "XLI"),
    (3600, 3699, "XLK"),
    (3700, 3799, "XLI"),
    (3800, 3899, "XLK"),
    (3900, 3999, "XLY"),
    (4000, 4799, "XLI"),
    (4800, 4899, "XLC"),
    (4900, 4999, "XLU"),
    (5000, 5199, "XLI"),
    (5200, 5999, "XLY"),
    (6000, 6499, "XLF"),
    (6700, 6799, "XLF"),
    (7000, 7299, "XLY"),
    (7300, 7399, "XLI"),
    (8000, 8099, "XLV"),
    (8700, 8799, "XLI"),
]

DEFAULT_BENCHMARK = "SPY"


@dataclass(frozen=True)
class SectorInfo:
    pack: str  # 'general' | 'bank' | 'reit' | 'insurer'
    etf: str
    ambiguous_reason: str | None = None


def classify(sic: str | int | None) -> SectorInfo:
    try:
        code = int(sic) if sic not in (None, "") else None
    except (TypeError, ValueError):
        code = None
    if code is None:
        return SectorInfo("general", DEFAULT_BENCHMARK, "No SIC code on file")
    etf = next((e for lo, hi, e in _ETF_RANGES if lo <= code <= hi), DEFAULT_BENCHMARK)
    if code in BANK_SIC:
        return SectorInfo("bank", "XLF")
    if code in REIT_SIC:
        return SectorInfo("reit", "XLRE")
    if code in INSURER_SIC:
        return SectorInfo("insurer", "XLF")
    if code in AMBIGUOUS_SIC:
        return SectorInfo("general", etf, AMBIGUOUS_SIC[code])
    return SectorInfo("general", etf)
