import "server-only";
import { select, selectAll } from "@/lib/db";
import { GENERAL_GROUPS, PACK_GROUPS } from "@/lib/metrics";
import type { CompactRow, FinancialsData } from "@/components/FinancialsView";
import type { Company, Filing, Job, MetricValue, PricePoint, TickerHit } from "@/lib/types";

export async function getCompanyByTicker(ticker: string): Promise<Company | null> {
  const rows = await select<Company>("companies", { ticker: `eq.${ticker}`, select: "*" });
  if (rows.length) return rows[0];
  // Share-class tickers (e.g. GOOG vs GOOGL) map to the same CIK.
  const t = await select<TickerHit>("tickers", { ticker: `eq.${ticker}`, select: "cik" });
  if (!t.length) return null;
  const byCik = await select<Company>("companies", { cik: `eq.${t[0].cik}`, select: "*" });
  return byCik[0] ?? null;
}

export async function getTicker(ticker: string): Promise<TickerHit | null> {
  const rows = await select<TickerHit>("tickers", { ticker: `eq.${ticker}`, select: "*" });
  return rows[0] ?? null;
}

export async function getLatestJob(ticker: string): Promise<Job | null> {
  const rows = await select<Job>("jobs", { ticker: `eq.${ticker}`, kind: "eq.analyze", order: "created_at.desc", limit: "1" });
  return rows[0] ?? null;
}

export async function getPrices(ticker: string): Promise<PricePoint[]> {
  return selectAll<PricePoint>("prices", { ticker: `eq.${ticker}`, select: "date,close,adj_close,volume", order: "date.asc" });
}

export async function getFilings(cik: number): Promise<Filing[]> {
  return selectAll<Filing>("filings", { cik: `eq.${cik}`, select: "accession,form,filed_date,report_date,url", order: "filed_date.desc" });
}

/** Metric series for the Financials tab, compacted to keep the page light. */
export async function getFinancials(company: Company, filings: Filing[]): Promise<FinancialsData> {
  const keys = [
    ...GENERAL_GROUPS.flatMap((g) => g.metrics.map((m) => m.key)),
    ...(PACK_GROUPS[company.sector_pack]?.metrics.map((m) => m.key) ?? []),
  ];
  const rows = await selectAll<MetricValue>("metric_values", {
    cik: `eq.${company.cik}`,
    metric: `in.(${[...new Set(keys)].join(",")})`,
    select: "metric,fiscal_year,fiscal_period,period_end,value,unit,source,xbrl_tag,derivation,accession",
    order: "period_end.asc",
  });
  const unresolved = await select<{ metric: string; reason: string }>("unresolved_metrics", {
    cik: `eq.${company.cik}`,
    select: "metric,reason",
  });

  const derivations: string[] = [];
  const dIdx = new Map<string, number>();
  const series: Record<string, CompactRow[]> = {};
  for (const r of rows) {
    let di = -1;
    if (r.derivation) {
      di = dIdx.get(r.derivation) ?? -1;
      if (di < 0) {
        di = derivations.push(r.derivation) - 1;
        dIdx.set(r.derivation, di);
      }
    }
    (series[r.metric] ??= []).push([
      r.fiscal_year,
      r.fiscal_period,
      r.value,
      r.source,
      r.xbrl_tag,
      di,
      r.accession,
      r.period_end,
      r.unit,
    ]);
  }
  return {
    cik: company.cik,
    currency: company.currency,
    series,
    derivations,
    unresolved: Object.fromEntries(unresolved.map((u) => [u.metric, u.reason])),
    filings: Object.fromEntries(filings.map((f) => [f.accession, { form: f.form, filed: f.filed_date, url: f.url }])),
  };
}
