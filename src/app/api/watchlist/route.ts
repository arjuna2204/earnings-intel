import type { NextRequest } from "next/server";
import { select } from "@/lib/db";

export type WatchItem = {
  ticker: string;
  name: string;
  loaded: boolean;
  price: number | null;
  change: number | null; // last close vs prior close
  priceDate: string | null;
  nextReport: string | null; // upcoming earnings date
  lastReport: string | null; // most recent results release (8-K item 2.02 or reported quarter)
  lastQuarter: string | null; // e.g. FY2026Q1, when known
  surprise: number | null; // EPS vs estimate, last reported quarter
};

const T = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Watchlist data for up to 30 tickers. The list itself lives in the visitor's browser. */
export async function GET(req: NextRequest) {
  const tickers = [...new Set((req.nextUrl.searchParams.get("t") ?? "").toUpperCase().split(","))].filter((t) => T.test(t)).slice(0, 30);
  if (!tickers.length) return Response.json({ items: [] });
  const list = tickers.map((t) => `"${t}"`).join(",");
  try {
    const [companies, names, cal] = await Promise.all([
      select<{ cik: number; ticker: string; name: string }>("companies", { ticker: `in.(${list})`, select: "cik,ticker,name" }),
      select<{ ticker: string; name: string }>("tickers", { ticker: `in.(${list})`, select: "ticker,name" }),
      select<{ ticker: string; report_date: string }>("earnings_calendar", { ticker: `in.(${list})`, select: "ticker,report_date" }),
    ]);
    const ciks = companies.map((c) => c.cik).join(",");
    const recentFrom = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    const [events, releases, prices] = await Promise.all([
      ciks
        ? select<{ cik: number; fiscal_year: number; fiscal_quarter: number; report_date: string; eps_reported: number | null; eps_estimated: number | null }>(
            "earnings_events",
            { cik: `in.(${ciks})`, report_date: `gte.${recentFrom}`, select: "cik,fiscal_year,fiscal_quarter,report_date,eps_reported,eps_estimated", order: "report_date.desc" },
          )
        : [],
      ciks
        ? select<{ cik: number; filed_date: string }>("filings", {
            cik: `in.(${ciks})`,
            form: "eq.8-K",
            items: "like.*2.02*",
            filed_date: `gte.${recentFrom}`,
            select: "cik,filed_date",
            order: "filed_date.desc",
          })
        : [],
      Promise.all(
        companies.map((c) =>
          select<{ date: string; close: number }>("prices", { ticker: `eq.${c.ticker}`, select: "date,close", order: "date.desc", limit: "2" }).then((p) => [c.ticker, p] as const),
        ),
      ),
    ]);
    const px = new Map(prices);
    const items: WatchItem[] = tickers.map((t) => {
      const c = companies.find((x) => x.ticker === t);
      const p = px.get(t) ?? [];
      const ev = c ? events.find((e) => e.cik === c.cik) : undefined;
      const rel = c ? releases.find((r) => r.cik === c.cik) : undefined;
      const last = [ev?.report_date, rel?.filed_date].filter(Boolean).sort().at(-1) ?? null;
      return {
        ticker: t,
        name: c?.name ?? names.find((n) => n.ticker === t)?.name ?? t,
        loaded: !!c,
        price: p[0]?.close ?? null,
        change: p.length === 2 && p[1].close ? p[0].close / p[1].close - 1 : null,
        priceDate: p[0]?.date ?? null,
        nextReport: cal.find((x) => x.ticker === t)?.report_date ?? null,
        lastReport: last,
        lastQuarter: ev && ev.report_date === last ? `FY${ev.fiscal_year}Q${ev.fiscal_quarter}` : null,
        surprise: ev && ev.report_date === last && ev.eps_reported != null && ev.eps_estimated ? ev.eps_reported / ev.eps_estimated - 1 : null,
      };
    });
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ items: [], error: (e as Error).message }, { status: 500 });
  }
}
