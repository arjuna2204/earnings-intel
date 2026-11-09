import "server-only";
import { selectAll } from "@/lib/db";
import { etfName } from "@/lib/etfs";
import type { Valuation } from "@/lib/types";

/** One row per loaded company: the numbers the screener sorts and filters on. All come from tables the
 * daily job already fills (no extra API calls): filings, prices, risk stats, options and the DCF. */
export type ScreenRow = {
  ticker: string;
  name: string;
  sector: string | null;
  price: number | null;
  marketCap: number | null;
  pe: number | null;
  fwdPe: number | null;
  evEbitda: number | null;
  fcfYield: number | null;
  divYield: number | null;
  revGrowth: number | null;
  opMargin: number | null;
  roic: number | null;
  ret1y: number | null;
  beta: number | null;
  vol: number | null;
  fscore: number | null;
  dcfUpside: number | null;
  nextEarnings: string | null;
  expectedMove: number | null;
};

const METRICS = ["revenue_growth_yoy", "operating_margin", "roic"] as const;

type MetricRow = { cik: number; metric: string; fiscal_period: string; period_end: string; value: number };

export async function screenRows(): Promise<ScreenRow[]> {
  const since = new Date(Date.now() - 500 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const [companies, metrics, risk, opts, dcfs, cal] = await Promise.all([
    selectAll<{ cik: number; ticker: string; name: string; sector_etf: string | null; valuation: Valuation | null; currency: string | null }>(
      "companies",
      { select: "cik,ticker,name,sector_etf,valuation,currency" },
    ),
    selectAll<MetricRow>("metric_values", {
      metric: `in.(${METRICS.join(",")})`,
      period_end: `gte.${since}`,
      select: "cik,metric,fiscal_period,period_end,value",
      order: "period_end.asc",
    }),
    selectAll<{ cik: number; y1: number | null; beta: number | null; vol: number | null; fscore: number | null }>("risk_stats", {
      select: "cik,y1:result->returns->y1,beta:result->beta->y1,vol:result->volatility->y1,fscore:result->fundamental->piotroski->score",
    }),
    selectAll<{ cik: number; move: number | null; edate: string | null }>("options_snapshot", {
      select: "cik,move:result->earnings->day_move,edate:result->earnings->>date",
    }),
    selectAll<{ cik: number; status: string; upside: number | null }>("dcf_models", { select: "cik,status,upside:result->upside" }),
    selectAll<{ ticker: string; report_date: string }>("earnings_calendar", {
      report_date: `gte.${today}`,
      select: "ticker,report_date",
      order: "report_date.asc",
    }),
  ]);

  // latest value per company per metric (quarterly rows end later than the fiscal year they belong to)
  const latest = new Map<string, number>();
  for (const m of metrics) latest.set(`${m.cik}:${m.metric}`, m.value);
  const riskBy = new Map(risk.map((r) => [r.cik, r]));
  const optBy = new Map(opts.map((o) => [o.cik, o]));
  const dcfBy = new Map(dcfs.filter((d) => d.status === "ok").map((d) => [d.cik, d.upside]));
  const nextBy = new Map<string, string>();
  for (const c of cal) if (!nextBy.has(c.ticker)) nextBy.set(c.ticker, c.report_date);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  return companies
    .filter((c) => c.valuation?.price)
    .map((c) => {
      const v = c.valuation ?? ({} as Valuation);
      const r = riskBy.get(c.cik);
      const o = optBy.get(c.cik);
      const next = nextBy.get(c.ticker) ?? null;
      return {
        ticker: c.ticker,
        name: c.name,
        sector: etfName(c.sector_etf),
        price: num(v.price),
        marketCap: num(v.market_cap),
        pe: num(v.pe),
        fwdPe: num(v.pe_fwd_ntm),
        evEbitda: num(v.ev_ebitda),
        fcfYield: num(v.fcf_yield),
        divYield: num(v.dividend_yield),
        revGrowth: num(latest.get(`${c.cik}:revenue_growth_yoy`)),
        opMargin: num(latest.get(`${c.cik}:operating_margin`)),
        roic: num(latest.get(`${c.cik}:roic`)),
        ret1y: num(r?.y1),
        beta: num(r?.beta),
        vol: num(r?.vol),
        fscore: num(r?.fscore),
        dcfUpside: num(dcfBy.get(c.cik)),
        nextEarnings: next,
        // the options-implied earnings-day move only applies to the report the options were priced for
        expectedMove: o?.edate && next && o.edate === next ? num(o.move) : null,
      };
    });
}

export type CalendarRow = {
  ticker: string;
  name: string;
  date: string;
  epsEstimate: number | null;
  rank: number | null;
  loaded: boolean;
  expectedMove: number | null;
  lastReport: string | null;
};

/** Reports from today through the next `days` days, biggest companies first within each day. */
export async function upcomingEarnings(days = 7): Promise<CalendarRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const [cal, universe, companies, opts] = await Promise.all([
    selectAll<{ ticker: string; report_date: string; eps_estimate: number | null; last_report_date: string | null }>("earnings_calendar", {
      report_date: `gte.${today}`,
      and: `(report_date.lte.${end})`,
      select: "ticker,report_date,eps_estimate,last_report_date",
    }),
    selectAll<{ ticker: string; name: string; rank: number | null }>("universe", { select: "ticker,name,rank" }),
    selectAll<{ cik: number; ticker: string; name: string }>("companies", { select: "cik,ticker,name" }),
    selectAll<{ cik: number; move: number | null; edate: string | null }>("options_snapshot", {
      select: "cik,move:result->earnings->day_move,edate:result->earnings->>date",
    }),
  ]);
  const uni = new Map(universe.map((u) => [u.ticker, u]));
  const loaded = new Map(companies.map((c) => [c.ticker, c]));
  const optBy = new Map(opts.map((o) => [o.cik, o]));
  return cal
    .map((e) => {
      const u = uni.get(e.ticker);
      const c = loaded.get(e.ticker);
      const o = c ? optBy.get(c.cik) : undefined;
      return {
        ticker: e.ticker,
        name: c?.name ?? u?.name ?? e.ticker,
        date: e.report_date,
        epsEstimate: e.eps_estimate != null ? Number(e.eps_estimate) : null,
        rank: u?.rank ?? null,
        loaded: Boolean(c),
        expectedMove: o?.edate === e.report_date && typeof o?.move === "number" ? o.move : null,
        lastReport: e.last_report_date,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
}
