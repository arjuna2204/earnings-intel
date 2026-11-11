import "server-only";
import { select, selectAll } from "@/lib/db";
import { etfName } from "@/lib/etfs";
import { CBOE_ON } from "@/lib/flags";
import { getFlags, hiddenFields } from "@/lib/quality";
import type { Valuation } from "@/lib/types";

/** What the portfolio page needs for one holding. Everything comes from data already stored. */
export type Holding = {
  ticker: string;
  name: string;
  covered: "full" | "basic" | "none";
  price: number | null;
  priceDate: string | null;
  sector: string | null;
  dps: number | null; // dividends per share, last 12 months
  divYield: number | null;
  beta: number | null;
  ret1y: number | null;
  nextEarnings: string | null;
  expectedMove: number | null;
  regions: { label: string; share: number }[]; // latest fiscal year, revenue shares by region
};

export async function holdings(tickers: string[]): Promise<Holding[]> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase().trim()).filter((t) => /^[A-Z0-9.\-]{1,10}$/.test(t)))].slice(0, 60);
  if (!list.length) return [];
  const inList = `in.(${list.map((t) => `"${t}"`).join(",")})`;
  const today = new Date().toISOString().slice(0, 10);
  const [companies, lite, cal] = await Promise.all([
    select<{ cik: number; ticker: string; name: string; sector_etf: string | null; valuation: Valuation | null }>("companies", {
      ticker: inList,
      select: "cik,ticker,name,sector_etf,valuation",
    }).catch(() => []),
    CBOE_ON
      ? select<{ cik: number; ticker: string; name: string; snapshot: Record<string, unknown> }>("lite_companies", { ticker: inList, select: "cik,ticker,name,snapshot" }).catch(
          () => [],
        )
      : Promise.resolve([]),
    select<{ ticker: string; report_date: string }>("earnings_calendar", { ticker: inList, report_date: `gte.${today}`, select: "ticker,report_date", order: "report_date" }).catch(() => []),
  ]);
  const ciks = companies.map((c) => c.cik);
  const cikIn = `in.(${ciks.join(",") || "0"})`;
  const [risk, opts, segs, flags] = await Promise.all([
    select<{ cik: number; beta: number | null; y1: number | null }>("risk_stats", { cik: cikIn, select: "cik,beta:result->beta->y1,y1:result->returns->y1" }).catch(() => []),
    CBOE_ON
      ? select<{ cik: number; move: number | null; edate: string | null }>("options_snapshot", { cik: cikIn, select: "cik,move:result->earnings->day_move,edate:result->earnings->>date" }).catch(() => [])
      : Promise.resolve([]),
    selectAll<{ cik: number; label: string; fiscal_year: number; value: number; adds_up: boolean | null }>("segment_values", {
      cik: cikIn,
      axis: "eq.region",
      measure: "eq.revenue",
      fiscal_period: "eq.FY",
      select: "cik,label,fiscal_year,value,adds_up",
    }).catch(() => []),
    Promise.all(ciks.map((c) => getFlags(c).then((f) => [c, f] as const))),
  ]);
  const flagBy = new Map(flags);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const next = new Map<string, string>();
  for (const c of cal) if (!next.has(c.ticker)) next.set(c.ticker, c.report_date);

  return list.map((t): Holding => {
    const c = companies.find((x) => x.ticker === t);
    if (c) {
      const v = c.valuation ?? ({} as Valuation);
      const hide = hiddenFields(flagBy.get(c.cik) ?? []);
      const r = risk.find((x) => x.cik === c.cik);
      const o = opts.find((x) => x.cik === c.cik);
      const mine = segs.filter((s) => s.cik === c.cik);
      const fy = mine.length ? Math.max(...mine.map((s) => s.fiscal_year)) : null;
      const latest = mine.filter((s) => s.fiscal_year === fy && s.value > 0);
      const total = latest.reduce((a, s) => a + s.value, 0);
      return {
        ticker: t,
        name: c.name,
        covered: "full",
        price: num(v.price),
        priceDate: v.price_date ?? null,
        sector: etfName(c.sector_etf),
        dps: hide.has("dividend_per_share_ttm") ? null : num(v.dividend_per_share_ttm),
        divYield: hide.has("dividend_yield") ? null : num(v.dividend_yield),
        beta: num(r?.beta),
        ret1y: num(r?.y1),
        nextEarnings: next.get(t) ?? null,
        expectedMove: o?.edate && o.edate === next.get(t) ? num(o.move) : null,
        regions: total > 0 ? latest.map((s) => ({ label: s.label, share: s.value / total })) : [],
      };
    }
    const l = lite.find((x) => x.ticker === t);
    if (l) {
      const s = l.snapshot;
      return {
        ticker: t,
        name: l.name,
        covered: "basic",
        price: num(s.price),
        priceDate: (s.price_date as string) ?? null,
        sector: etfName((s.sector_etf as string) ?? null),
        dps: num(s.dividend_per_share_ttm),
        divYield: num(s.dividend_yield),
        beta: null,
        ret1y: num(s.return_1y),
        nextEarnings: next.get(t) ?? null,
        expectedMove: null,
        regions: [],
      };
    }
    return { ticker: t, name: t, covered: "none", price: null, priceDate: null, sector: null, dps: null, divYield: null, beta: null, ret1y: null, nextEarnings: next.get(t) ?? null, expectedMove: null, regions: [] };
  });
}
