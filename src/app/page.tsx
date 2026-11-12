import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import SearchBox from "@/components/SearchBox";
import WatchlistPanel from "@/components/WatchlistPanel";
import { select } from "@/lib/db";
import type { Company } from "@/lib/types";

export default function Home() {
  return (
    <main className="page-wrap flex flex-1 flex-col pb-20 pt-14 sm:pt-24">
      <div className="max-w-3xl">
        <h1 className="text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Equity Research for the
          <br />
          <span className="text-accent">everyday investor</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          What changed this quarter, what the Street expects, and what the stock
          could be worth — from SEC filings and earnings calls, with every
          number linked to its source.
        </p>
        <div className="mt-8">
          <SearchBox autoFocus large />
        </div>
        <p className="mt-4 text-sm text-muted">
          New here?{" "}
          <Link
            href="/coverage"
            className="font-semibold text-accent hover:underline"
          >
            See which companies are ready to explore
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link
            href="/earnings"
            className="rounded-full bg-card px-3 py-1.5 font-medium hover:bg-border"
          >
            Earnings this week
          </Link>
          <Link
            href="/screener"
            className="rounded-full bg-card px-3 py-1.5 font-medium hover:bg-border"
          >
            Screener
          </Link>
          <Link
            href="/portfolio"
            className="rounded-full bg-card px-3 py-1.5 font-medium hover:bg-border"
          >
            Your portfolio
          </Link>
        </div>
      </div>
      {/* lower half: your stocks on the left, what the site does on the right (stacks on phones) */}
      <div className="mt-4 grid gap-x-16 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <div id="watchlist" className="scroll-mt-20">
            <WatchlistPanel />
          </div>
          <Suspense fallback={<RecentSkeleton />}>
            <Recent />
          </Suspense>
        </div>
        <section className="mt-12">
          <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">
            What you get for every stock
          </h2>
          <ul className="divide-y divide-border">
            {FEATURES.map(([title, text]) => (
              <li
                key={title}
                className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6 lg:grid-cols-1 lg:gap-1"
              >
                <span className="font-semibold">{title}</span>
                <span className="text-[15px] leading-relaxed text-muted">
                  {text}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted">
            Curious whether the signals work?{" "}
            <Link
              href="/backtest"
              className="font-semibold text-accent hover:underline"
            >
              See the backtest
            </Link>
            . Research, not investment advice.
          </p>
        </section>
      </div>
    </main>
  );
}

const FEATURES: [string, string][] = [
  [
    "Brief",
    "What changed between two quarters — beat or miss, guidance, what drove the numbers, and where the call and the filing don't line up.",
  ],
  [
    "StreetView",
    "Consensus estimates, beat history, forward valuation, bull / base / bear cases and a DCF you can download to Excel.",
  ],
  [
    "Historical",
    "15 years of financials straight from SEC filings, charted quarter by quarter.",
  ],
  [
    "Call",
    "Two earnings calls side by side: guidance changes, topics, tone, and the questions management dodged.",
  ],
  [
    "Filings",
    "The company's own adjusted numbers, management's explanation of results, and a redline of new risk factors.",
  ],
  [
    "Peers",
    "How it stacks up against competitors on valuation, growth, profitability and Street track record.",
  ],
];

async function Recent() {
  await connection(); // always live data
  let rows: Pick<
    Company,
    "ticker" | "name" | "last_ingested_at" | "valuation"
  >[] = [];
  let total = 0;
  try {
    const all = await select<
      Pick<Company, "ticker" | "name" | "last_ingested_at" | "valuation">
    >("companies", {
      select: "ticker,name,last_ingested_at,valuation",
      order: "last_ingested_at.desc.nullslast",
      limit: "200",
    });
    total = all.filter((c) => c.valuation?.price != null).length;
    rows = all.filter((c) => c.valuation?.price != null).slice(0, 8);
  } catch {
    return (
      <p className="mt-10 text-sm text-muted">
        Can&apos;t reach the database. Open{" "}
        <a href="/api/health" className="text-accent underline">
          the setup check
        </a>{" "}
        to see which setting needs fixing.
      </p>
    );
  }
  if (!rows.length)
    return (
      <p className="mt-10 text-sm text-muted">
        No companies loaded yet — search for one to start.
      </p>
    );
  // last two closes for each, for the day's move
  const since = daysAgo(10);
  const px = await select<{ ticker: string; date: string; adj_close: number }>(
    "prices",
    {
      ticker: `in.(${rows.map((r) => r.ticker).join(",")})`,
      date: `gte.${since}`,
      select: "ticker,date,adj_close",
      order: "date.asc",
    },
  ).catch(() => []);
  const change = (t: string) => {
    const p = px.filter((x) => x.ticker === t);
    return p.length >= 2
      ? p[p.length - 1].adj_close / p[p.length - 2].adj_close - 1
      : null;
  };
  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <h2 className="text-xl font-semibold tracking-tight">
          Recently updated research
        </h2>
        <Link
          href="/coverage"
          className="text-sm font-medium text-accent hover:underline"
        >
          All {total} →
        </Link>
      </div>
      <p className="mt-2 text-xs text-muted">
        Companies with full research on Earnings Intel, newest first. Your own
        list is the watchlist above.
      </p>
      <ul className="divide-y divide-border">
        {rows.map((c) => {
          const ch = change(c.ticker);
          return (
            <li key={c.ticker}>
              <Link
                href={`/c/${c.ticker}`}
                className="flex items-baseline gap-4 py-3.5 hover:text-accent"
              >
                <span className="w-16 shrink-0 font-semibold">{c.ticker}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {c.name}
                </span>
                {c.valuation?.price != null && (
                  <span className="shrink-0 font-semibold tabular-nums">
                    ${c.valuation.price.toFixed(2)}
                  </span>
                )}
                <span
                  className={`w-16 shrink-0 text-right text-sm tabular-nums ${ch == null ? "text-muted" : ch >= 0 ? "text-up" : "text-down"}`}
                >
                  {ch == null
                    ? ""
                    : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(1)}%`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function RecentSkeleton() {
  return (
    <div className="mt-12 space-y-2">
      <div className="skeleton h-4 w-32" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton h-12" />
      ))}
    </div>
  );
}
