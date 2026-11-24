import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import SearchBox from "@/components/SearchBox";
import WatchlistPanel from "@/components/WatchlistPanel";
import { select } from "@/lib/db";
import type { Company } from "@/lib/types";

export default function Home() {
  return (
    <div className="lit flex flex-1 flex-col">
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-20 pt-14 sm:pt-24">
      <h1 className="text-balance text-[40px] font-medium leading-[1.05] sm:text-6xl">
        Equity Research for the <br className="hidden sm:block" />
        <span className="text-accent">everyday investor</span>
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
        What changed this quarter, what the Street expects, and what the stock could be worth — from SEC filings and earnings calls,
        with every number linked to its source.
      </p>
      <div className="mt-8">
        <SearchBox autoFocus large />
      </div>
      <p className="mt-4 text-sm text-muted">
        New here?{" "}
        <Link href="/coverage" className="font-semibold text-accent hover:underline">
          See which companies are ready to explore
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <Link href="/earnings" className="rounded-full bg-card px-3 py-1.5 font-medium hover:bg-border">
          Earnings this week
        </Link>
        <Link href="/screener" className="rounded-full bg-card px-3 py-1.5 font-medium hover:bg-border">
          Screener
        </Link>
        <Link href="/portfolio" className="rounded-full bg-card px-3 py-1.5 font-medium hover:bg-border">
          Your portfolio
        </Link>
      </div>
      <Why />
      <div id="watchlist" className="scroll-mt-20">
        <WatchlistPanel />
      </div>
      <Suspense fallback={<RecentSkeleton />}>
        <Recent />
      </Suspense>
      <p className="mt-12 text-sm text-muted">
        Curious whether the signals work?{" "}
        <Link href="/backtest" className="font-semibold text-accent hover:underline">
          See the backtest
        </Link>
        . Research, not investment advice.
      </p>
    </main>
    </div>
  );
}

/** Why the site exists, on the first page: the one-line difference, three things that set it apart, and who it's for. */
function Why() {
  return (
    <section className="mt-16" aria-labelledby="why">
      <h2 id="why" className="text-balance text-2xl font-medium leading-snug sm:text-3xl">
        Finance sites show you the numbers. <span className="text-muted">We explain what changed, why, and whether it matters.</span>
      </h2>
      <dl className="mt-8 grid gap-x-8 gap-y-5 border-t border-border pt-5 sm:grid-cols-3">
        {WHY.map(([title, text]) => (
          <div key={title}>
            <dt className="font-semibold">
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-hidden="true" />
              {title}
            </dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-muted">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-[15px] leading-relaxed text-muted">
        <b className="font-semibold text-foreground">Best for:</b> checking a company right after it reports, deciding whether to buy, or building a
        stock pitch.{" "}
        <Link href="/about" className="font-semibold text-accent hover:underline">
          How it works and how it&apos;s different →
        </Link>
      </p>
    </section>
  );
}

const WHY: [string, string][] = [
  ["What changed, not just what is", "Any two quarters compared: guidance, what drove the numbers, the call against the last one, and new risk factors."],
  ["A source for every claim", "Every point links to the SEC filing or call quote it came from, so you can check it yourself."],
  ["Analyst math, free", "Adjusted figures, a DCF you can download to Excel, bull / base / bear cases and peer comparison."],
];

async function Recent() {
  await connection(); // always live data
  let rows: Pick<Company, "ticker" | "name" | "last_ingested_at" | "valuation">[] = [];
  let total = 0;
  try {
    const all = await select<Pick<Company, "ticker" | "name" | "last_ingested_at" | "valuation">>("companies", {
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
  if (!rows.length) return <p className="mt-10 text-sm text-muted">No companies loaded yet — search for one to start.</p>;
  // last two closes for each, for the day's move
  const since = daysAgo(10);
  const px = await select<{ ticker: string; date: string; adj_close: number }>("prices", {
    ticker: `in.(${rows.map((r) => r.ticker).join(",")})`,
    date: `gte.${since}`,
    select: "ticker,date,adj_close",
    order: "date.asc",
  }).catch(() => []);
  const change = (t: string) => {
    const p = px.filter((x) => x.ticker === t);
    return p.length >= 2 ? p[p.length - 1].adj_close / p[p.length - 2].adj_close - 1 : null;
  };
  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <h2 className="text-xl font-semibold tracking-tight">Recently updated research</h2>
        <Link href="/coverage" className="text-sm font-medium text-accent hover:underline">
          All {total} →
        </Link>
      </div>
      <p className="mt-2 text-xs text-muted">Companies with full research on Earnings Intel, newest first. Your own list is the watchlist above.</p>
      <ul className="divide-y divide-border">
        {rows.map((c) => {
          const ch = change(c.ticker);
          return (
            <li key={c.ticker}>
              <Link href={`/c/${c.ticker}`} className="flex items-center gap-4 py-3 hover:text-accent">
                <span className="w-16 shrink-0 font-semibold">{c.ticker}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{c.name}</span>
                {c.valuation?.price != null && <span className="figure shrink-0">${c.valuation.price.toFixed(2)}</span>}
                <span className="w-20 shrink-0 text-right">
                  {ch != null && <Chip v={ch} />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Day's move as a tinted pill (green up, orange-red down). */
function Chip({ v }: { v: number }) {
  return (
    <span className={`figure inline-flex rounded-full px-2.5 py-1 text-[13px] ${v >= 0 ? "bg-up/15 text-up" : "bg-down/15 text-down"}`}>
      {v >= 0 ? "+" : "−"}
      {Math.abs(v * 100).toFixed(1)}%
    </span>
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
