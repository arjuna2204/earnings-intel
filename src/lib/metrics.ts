/** Display catalog for metrics. Values are computed in the pipeline; this file only formats. */

export type Fmt = "money" | "pct" | "x" | "per_share" | "shares" | "days";

export type MetricInfo = { key: string; label: string; fmt: Fmt; help?: string };

export type MetricGroup = { title: string; metrics: MetricInfo[] };

const m = (key: string, label: string, fmt: Fmt, help?: string): MetricInfo => ({ key, label, fmt, help });

export const GENERAL_GROUPS: MetricGroup[] = [
  {
    title: "Growth & profitability",
    metrics: [
      m("revenue", "Revenue", "money"),
      m("revenue_growth_yoy", "Revenue growth (YoY)", "pct"),
      m("gross_margin", "Gross margin", "pct"),
      m("operating_margin", "Operating margin", "pct"),
      m("net_income", "Net income", "money"),
      m("eps_diluted", "Diluted EPS", "per_share"),
      m("eps_growth_yoy", "EPS growth (YoY)", "pct"),
      m("ebitda", "EBITDA", "money"),
    ],
  },
  {
    title: "Cash flow",
    metrics: [
      m("operating_cash_flow", "Operating cash flow", "money"),
      m("capex", "Capital expenditures", "money"),
      m("free_cash_flow", "Free cash flow", "money"),
      m("fcf_margin", "FCF margin", "pct"),
      m("capex_to_revenue", "Capex / revenue", "pct"),
    ],
  },
  {
    title: "Dividends & buybacks",
    metrics: [
      m("dividends_per_share", "Dividends per share", "per_share"),
      m("dividends_paid", "Dividends paid", "money"),
      m("buybacks", "Share buybacks", "money"),
      m("shareholder_returns", "Total returned to shareholders", "money"),
      m("payout_ratio", "Dividend payout ratio", "pct"),
      m("returns_to_fcf", "Returned ÷ free cash flow", "pct"),
    ],
  },
  {
    title: "Balance sheet & returns",
    metrics: [
      m("cash", "Cash & equivalents", "money"),
      m("total_debt", "Total debt", "money"),
      m("net_debt", "Net debt", "money"),
      m("net_debt_to_ebitda", "Net debt / EBITDA", "x"),
      m("roic", "ROIC", "pct"),
      m("roe", "ROE", "pct"),
      m("current_ratio", "Current ratio", "x"),
      m("dso", "Days sales outstanding", "days"),
      m("inventory_turns", "Inventory turns", "x"),
      m("diluted_shares", "Diluted shares", "shares"),
    ],
  },
];

export const PACK_GROUPS: Record<string, MetricGroup> = {
  bank: {
    title: "Bank metrics",
    metrics: [
      m("net_interest_margin", "Net interest margin", "pct"),
      m("efficiency_ratio", "Efficiency ratio", "pct", "Lower is better"),
      m("loan_to_deposit", "Loan-to-deposit", "pct"),
      m("net_chargeoff_ratio", "Net charge-off ratio", "pct"),
      m("allowance_to_loans", "Allowance / loans", "pct"),
      m("cet1_ratio", "CET1 ratio", "pct"),
      m("roa", "ROA", "pct"),
      m("rotce", "ROTCE", "pct"),
      m("net_interest_income", "Net interest income", "money"),
    ],
  },
  reit: {
    title: "REIT metrics",
    metrics: [
      m("ffo", "FFO", "money"),
      m("affo", "AFFO", "money"),
      m("occupancy", "Occupancy", "pct"),
      m("same_property_noi_growth", "Same-property NOI growth", "pct"),
      m("debt_to_ebitda", "Debt / EBITDA", "x"),
    ],
  },
  insurer: {
    title: "Insurance metrics",
    metrics: [
      m("combined_ratio", "Combined ratio", "pct", "Below 100% = underwriting profit"),
      m("loss_ratio", "Loss ratio", "pct"),
      m("expense_ratio", "Expense ratio", "pct"),
      m("book_value_per_share", "Book value / share", "per_share"),
      m("premiums_earned", "Premiums earned", "money"),
    ],
  },
};

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", TWD: "NT$", CAD: "C$" };

export function fmtValue(v: number | null | undefined, fmt: Fmt, unit = "USD"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "Not reported";
  const cur = unit.split("/")[0];
  const sym = CURRENCY_SYMBOL[cur] ?? `${cur} `;
  switch (fmt) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "x":
      return `${v.toFixed(2)}×`;
    case "days":
      return `${v.toFixed(0)} days`;
    case "per_share":
      return `${v < 0 ? "−" : ""}${sym}${Math.abs(v).toFixed(2)}`;
    case "shares":
      return compact(v);
    case "money":
      return `${v < 0 ? "−" : ""}${sym}${compact(Math.abs(v))}`;
  }
}

export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}

export function periodLabel(fy: number, fp: string): string {
  return fp === "FY" ? `FY${fy}` : `${fp} FY${fy}`;
}

export function secFilingIndexUrl(cik: number, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${accession}-index.htm`;
}

/** SEC filing index page, derived from the stored document URL (works for predecessor entities too). */
export function filingIndexFromDocUrl(docUrl: string, accession: string): string {
  return `${docUrl.slice(0, docUrl.lastIndexOf("/"))}/${accession}-index.htm`;
}
