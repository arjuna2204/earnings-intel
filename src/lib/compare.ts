import "server-only";
import { selectAll } from "@/lib/db";
import { getCompanyByTicker, getLatestJob, getPrices, getTicker } from "@/lib/company";
import { getDcf } from "@/lib/dcf";
import { getCases } from "@/lib/filings";
import type { Company, Job, TickerHit } from "@/lib/types";

/** Annual (fiscal-year) metrics shown side by side and in the trend chart. */
export const FY_METRICS = [
  "revenue",
  "revenue_growth_yoy",
  "gross_margin",
  "operating_margin",
  "fcf_margin",
  "eps_growth_yoy",
  "roic",
  "roe",
  "net_debt_to_ebitda",
  "current_ratio",
] as const;

export type CompareSide =
  | { status: "empty" }
  | { status: "not_found"; ticker: string }
  | { status: "not_loaded"; ticker: string; hit: TickerHit; job: Job | null }
  | {
      status: "ok";
      ticker: string;
      company: Pick<Company, "cik" | "ticker" | "name" | "exchange" | "sector_etf" | "sector_pack" | "currency" | "valuation">;
      prices: [string, number][]; // [date, adj_close], last ~5 years
      fy: Record<string, [number, number][]>; // metric -> [fiscal_year, value], oldest first
      dcf: { per_share: number | null; upside: number | null; note: string | null } | null;
      cases: { bear: number | null; base: number | null; bull: number | null; price: number; analysts: number } | null;
    };

export async function getCompareSide(raw: string | undefined): Promise<CompareSide> {
  const ticker = (raw ?? "").trim().toUpperCase().slice(0, 12);
  if (!ticker) return { status: "empty" };
  const company = await getCompanyByTicker(ticker);
  if (!company) {
    const hit = await getTicker(ticker);
    if (!hit) return { status: "not_found", ticker };
    return { status: "not_loaded", ticker, hit, job: await getLatestJob(ticker) };
  }
  const [prices, rows, dcf, cases] = await Promise.all([
    getPrices(company.ticker),
    selectAll<{ metric: string; fiscal_year: number; value: number }>("metric_values", {
      cik: `eq.${company.cik}`,
      fiscal_period: "eq.FY",
      metric: `in.(${FY_METRICS.join(",")})`,
      select: "metric,fiscal_year,value",
      order: "fiscal_year.asc",
    }),
    getDcf(company.cik),
    getCases(company.cik),
  ]);
  const cutoff = prices.length ? shiftYears(prices[prices.length - 1].date, -5) : "";
  const fy: Record<string, [number, number][]> = {};
  for (const r of rows) {
    const s = (fy[r.metric] ??= []);
    // one value per fiscal year (latest filing wins — rows arrive oldest first)
    if (s.length && s[s.length - 1][0] === r.fiscal_year) s[s.length - 1] = [r.fiscal_year, r.value];
    else s.push([r.fiscal_year, r.value]);
  }
  const sc = cases?.numbers.scenarios;
  return {
    status: "ok",
    ticker: company.ticker,
    company: {
      cik: company.cik,
      ticker: company.ticker,
      name: company.name,
      exchange: company.exchange,
      sector_etf: company.sector_etf,
      sector_pack: company.sector_pack,
      currency: company.currency,
      valuation: company.valuation,
    },
    prices: prices.filter((p) => p.date >= cutoff && p.adj_close).map((p) => [p.date, p.adj_close]),
    fy,
    dcf: dcf ? { per_share: dcf.result?.per_share ?? null, upside: dcf.result?.upside ?? null, note: dcf.status === "ok" ? null : dcf.note } : null,
    cases:
      cases && sc
        ? {
            bear: sc.bear?.value ?? null,
            base: sc.base?.value ?? null,
            bull: sc.bull?.value ?? null,
            price: cases.numbers.price,
            analysts: cases.numbers.analysts,
          }
        : null,
  };
}

function shiftYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
