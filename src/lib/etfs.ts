/** Funds anyone can add to a price chart. Their prices are kept current by the daily job (COMPARE_ETFS in pipeline/ei/jobs.py). */
export const COMPARE_ETFS: { ticker: string; name: string }[] = [
  { ticker: "SPY", name: "S&P 500" },
  { ticker: "QQQ", name: "Nasdaq-100" },
  { ticker: "DIA", name: "Dow Jones Industrial Average" },
  { ticker: "IWM", name: "Russell 2000 (small caps)" },
  { ticker: "VTI", name: "Total US stock market" },
  { ticker: "SMH", name: "Semiconductors" },
  { ticker: "GLD", name: "Gold" },
  { ticker: "TLT", name: "20+ year Treasury bonds" },
  { ticker: "XLK", name: "Technology sector" },
  { ticker: "XLF", name: "Financials sector" },
  { ticker: "XLV", name: "Health care sector" },
  { ticker: "XLY", name: "Consumer discretionary sector" },
  { ticker: "XLP", name: "Consumer staples sector" },
  { ticker: "XLE", name: "Energy sector" },
  { ticker: "XLI", name: "Industrials sector" },
  { ticker: "XLB", name: "Materials sector" },
  { ticker: "XLU", name: "Utilities sector" },
  { ticker: "XLRE", name: "Real estate sector" },
  { ticker: "XLC", name: "Communication services sector" },
];

export function etfName(ticker: string | null | undefined): string | null {
  return COMPARE_ETFS.find((e) => e.ticker === ticker)?.name ?? null;
}
