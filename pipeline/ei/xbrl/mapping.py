"""Standard metric definitions: for each metric, an ORDERED list of candidate XBRL tags.

The first candidate that has a value for a given period wins *for that period*, because
companies switch tags over time (e.g. `SalesRevenueNet` -> `RevenueFromContractWithCustomer...`).
Anything not found is reported as unresolved ("Not reported"), never guessed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Kind = Literal["duration", "instant"]
UnitKind = Literal["money", "per_share", "shares"]


@dataclass(frozen=True)
class MetricDef:
    name: str
    label: str
    kind: Kind
    unit: UnitKind
    us_gaap: tuple[str, ...]
    ifrs: tuple[str, ...] = ()
    additive: bool = True  # can quarters be summed / subtracted? (False for share counts)
    approx_when_derived: bool = False  # e.g. EPS: Q4 = FY - 9M is only approximate
    packs: tuple[str, ...] = ("general", "bank", "reit", "insurer")


M = MetricDef

REPORTED: tuple[MetricDef, ...] = (
    # --- Income statement ---
    M(
        "revenue",
        "Revenue",
        "duration",
        "money",
        (
            "Revenues",
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "RevenueFromContractWithCustomerIncludingAssessedTax",
            "SalesRevenueNet",
            "SalesRevenueGoodsNet",
            "RevenuesNetOfInterestExpense",
            "RealEstateRevenueNet",
        ),
        ("Revenue", "RevenueFromContractsWithCustomers"),
    ),
    M(
        "cost_of_revenue",
        "Cost of revenue",
        "duration",
        "money",
        ("CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"),
        ("CostOfSales",),
    ),
    M("gross_profit", "Gross profit", "duration", "money", ("GrossProfit",), ("GrossProfit",)),
    M(
        "operating_income",
        "Operating income",
        "duration",
        "money",
        ("OperatingIncomeLoss",),
        ("ProfitLossFromOperatingActivities",),
    ),
    M(
        "pretax_income",
        "Pre-tax income",
        "duration",
        "money",
        (
            "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
            "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
        ),
        ("ProfitLossBeforeTax",),
    ),
    M(
        "income_tax",
        "Income tax expense",
        "duration",
        "money",
        ("IncomeTaxExpenseBenefit",),
        ("IncomeTaxExpenseContinuingOperations",),
    ),
    M(
        "net_income",
        "Net income",
        "duration",
        "money",
        ("NetIncomeLoss", "ProfitLoss"),
        ("ProfitLossAttributableToOwnersOfParent", "ProfitLoss"),
    ),
    M(
        "eps_diluted",
        "Diluted EPS",
        "duration",
        "per_share",
        ("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"),
        ("DilutedEarningsLossPerShare",),
        approx_when_derived=True,
    ),
    M(
        "diluted_shares",
        "Diluted shares (weighted avg)",
        "duration",
        "shares",
        ("WeightedAverageNumberOfDilutedSharesOutstanding",),
        ("AdjustedWeightedAverageShares",),
        additive=False,
    ),
    M(
        "da",
        "Depreciation & amortization",
        "duration",
        "money",
        (
            "DepreciationDepletionAndAmortization",
            "DepreciationAndAmortization",
            "DepreciationAmortizationAndAccretionNet",
        ),
        (
            "DepreciationAndAmortisationExpense",
            "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
        ),
    ),
    # --- Cash flow ---
    M(
        "operating_cash_flow",
        "Operating cash flow",
        "duration",
        "money",
        (
            "NetCashProvidedByUsedInOperatingActivities",
            "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
        ),
        ("CashFlowsFromUsedInOperatingActivities",),
    ),
    M(
        "capex",
        "Capital expenditures",
        "duration",
        "money",
        ("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"),
        (
            "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
            "PurchaseOfPropertyPlantAndEquipment",
        ),
    ),
    # --- Balance sheet ---
    M(
        "cash",
        "Cash & equivalents",
        "instant",
        "money",
        (
            "CashAndCashEquivalentsAtCarryingValue",
            "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
            "Cash",
        ),
        ("CashAndCashEquivalents",),
    ),
    M("total_assets", "Total assets", "instant", "money", ("Assets",), ("Assets",)),
    M(
        "total_equity",
        "Shareholders' equity",
        "instant",
        "money",
        ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
        ("EquityAttributableToOwnersOfParent", "Equity"),
    ),
    M("current_assets", "Current assets", "instant", "money", ("AssetsCurrent",), ("CurrentAssets",)),
    M(
        "current_liabilities",
        "Current liabilities",
        "instant",
        "money",
        ("LiabilitiesCurrent",),
        ("CurrentLiabilities",),
    ),
    M(
        "accounts_receivable",
        "Accounts receivable",
        "instant",
        "money",
        ("AccountsReceivableNetCurrent", "ReceivablesNetCurrent"),
        ("CurrentTradeReceivables", "TradeAndOtherCurrentReceivables"),
    ),
    M("inventory", "Inventory", "instant", "money", ("InventoryNet",), ("Inventories",)),
    M("goodwill", "Goodwill", "instant", "money", ("Goodwill",), ("Goodwill",)),
    M(
        "intangibles",
        "Intangibles (ex-goodwill)",
        "instant",
        "money",
        ("IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"),
        ("IntangibleAssetsOtherThanGoodwill",),
    ),
    M("preferred_equity", "Preferred stock", "instant", "money", ("PreferredStockValue",)),
    M(
        "shares_outstanding_bs",
        "Shares outstanding (balance sheet)",
        "instant",
        "shares",
        ("CommonStockSharesOutstanding",),
        additive=False,
    ),
    # Debt components (combined into total_debt in derive.py)
    M("debt_long_total", "Long-term debt incl. current", "instant", "money", ("LongTermDebt",)),
    M(
        "debt_long_noncurrent",
        "Long-term debt, noncurrent",
        "instant",
        "money",
        ("LongTermDebtNoncurrent",),
        ("NoncurrentPortionOfNoncurrentBorrowings", "LongtermBorrowings"),
    ),
    M(
        "debt_long_current",
        "Long-term debt, current portion",
        "instant",
        "money",
        ("LongTermDebtCurrent",),
        ("CurrentPortionOfLongtermBorrowings", "CurrentPortionOfNoncurrentBorrowings"),
    ),
    M(
        "debt_short",
        "Short-term borrowings",
        "instant",
        "money",
        ("ShortTermBorrowings", "CommercialPaper"),
        ("ShorttermBorrowings", "CurrentBorrowings"),
    ),
    M("debt_ifrs_total", "Borrowings (IFRS total)", "instant", "money", (), ("Borrowings",)),
    # --- Bank pack ---
    M(
        "net_interest_income",
        "Net interest income",
        "duration",
        "money",
        ("InterestIncomeExpenseNet",),
        packs=("bank",),
    ),
    M(
        "noninterest_income",
        "Noninterest income",
        "duration",
        "money",
        ("NoninterestIncome",),
        packs=("bank",),
    ),
    M(
        "noninterest_expense",
        "Noninterest expense",
        "duration",
        "money",
        ("NoninterestExpense",),
        packs=("bank",),
    ),
    M(
        "loans_net",
        "Loans, net",
        "instant",
        "money",
        (
            "LoansAndLeasesReceivableNetReportedAmount",
            "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss",
        ),
        packs=("bank",),
    ),
    M(
        "loans_gross",
        "Loans, gross",
        "instant",
        "money",
        (
            "LoansAndLeasesReceivableNetOfDeferredIncome",
            "FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss",
            "LoansAndLeasesReceivableGrossCarryingAmount",
        ),
        packs=("bank",),
    ),
    M(
        "loan_allowance",
        "Allowance for credit losses",
        "instant",
        "money",
        (
            "FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest",
            "FinancingReceivableAllowanceForCreditLosses",
            "LoansAndLeasesReceivableAllowance",
        ),
        packs=("bank",),
    ),
    M("deposits", "Deposits", "instant", "money", ("Deposits",), packs=("bank",)),
    M(
        "net_chargeoffs",
        "Net charge-offs",
        "duration",
        "money",
        (
            "FinancingReceivableAllowanceForCreditLossWriteOffNet",
            "AllowanceForLoanAndLeaseLossesWriteOffsNet",
        ),
        packs=("bank",),
    ),
    # --- Insurer pack ---
    M(
        "premiums_earned",
        "Premiums earned",
        "duration",
        "money",
        ("PremiumsEarnedNet", "PremiumsEarnedNetPropertyAndCasualty"),
        packs=("insurer",),
    ),
    M(
        "losses_incurred",
        "Losses & LAE incurred",
        "duration",
        "money",
        ("PolicyholderBenefitsAndClaimsIncurredNet", "IncurredClaimsPropertyCasualtyAndLiability"),
        packs=("insurer",),
    ),
    M(
        "dac_amortization",
        "DAC amortization",
        "duration",
        "money",
        ("DeferredPolicyAcquisitionCostAmortizationExpense",),
        packs=("insurer",),
    ),
    M(
        "other_underwriting_expense",
        "Other underwriting expense",
        "duration",
        "money",
        ("OtherUnderwritingExpense",),
        packs=("insurer",),
    ),
)

BY_NAME: dict[str, MetricDef] = {m.name: m for m in REPORTED}

# Cover-page share count (dei taxonomy), used for current market cap.
DEI_SHARES_TAG = "EntityCommonStockSharesOutstanding"

# Metrics that standard XBRL does not carry. Shown as "Not reported" in Phase 1 and filled by
# AI extraction from filings/calls later, labeled "extracted, not reported" with the source quote.
NOT_IN_XBRL: dict[str, dict[str, str]] = {
    "bank": {
        "net_interest_margin": "Net interest margin isn't tagged in standard XBRL; it will be extracted from filings.",
        "cet1_ratio": "CET1 ratio isn't tagged in standard XBRL; it will be extracted from filings.",
    },
    "reit": {
        "ffo": "FFO is a non-GAAP measure, not in standard XBRL; it will be extracted from filings.",
        "affo": "AFFO is a non-GAAP measure, not in standard XBRL; it will be extracted where disclosed.",
        "occupancy": "Occupancy isn't in standard XBRL; it will be extracted from filings.",
        "same_property_noi_growth": "Same-property NOI growth isn't in standard XBRL; it will be extracted.",
        "p_ffo": "P/FFO needs FFO, which will be extracted from filings.",
    },
    "insurer": {},
    "general": {},
}
