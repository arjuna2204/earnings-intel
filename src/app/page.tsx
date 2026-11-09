import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import SearchBox from "@/components/SearchBox";
import { select } from "@/lib/db";
import type { Company } from "@/lib/types";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-20 pt-14 sm:pt-24">
      <h1 className="text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
        Equity Research for the
        <br />
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
      <Suspense fallback={<RecentSkeleton />}>
        <Recent />
      </Suspense>
      <section className="mt-16">
        <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">What you get for every stock</h2>
        <ul className="divide-y divide-border">
          {FEATURES.map(([title, text]) => (
            <li key={title} className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6">
              <span className="font-semibold">{title}</span>
              <span className="text-[15px] leading-relaxed text-muted">{text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted">
          Curious whether the signals work?{" "}
          <Link href="/backtest" className="font-semibold text-accent hover:underline">
            See the backtest
          </Link>
          . Research, not investment advice.
        </p>
      </section>
    </main>
  );
}

const FEATURES: [string, string][] = [
  ["Brief", "What changed between two quarters — beat or miss, guidance, what drove the numbers, and where the call and the filing don't line up."],
  ["StreetView", "Consensus estimates, beat history, forward valuation, bull / base / bear cases and a DCF you can download to Excel."],
  ["Historical", "15 years of financials straight from SEC filings, charted quarter by quarter."],
  ["Call", "Two earnings calls side by side: guidance changes, topics, tone, and the questions management dodged."],
  ["Filings", "The company's own adjusted numbers, management's explanation of results, and a redline of new risk factors."],
  ["Peers", "How it stacks up against competitors on valuation, growth, profitability and Street track record."],
];

async function Recent() {
  await connection(); // always live data
  let rows: Pick<Company, "ticker" | "name" | "last_ingested_at" | "valuation">[] = [];
  try {
    rows = await select("companies", {
      select: "ticker,name,last_ingested_at,valuation",
      is_primary: "eq.true",
      order: "last_ingested_at.desc.nullslast",
      limit: "12",
    });
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
  return (
    <section className="mt-12">
      <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Your companies</h2>
      <ul className="divide-y divide-border">
        {rows.map((c) => (
          <li key={c.ticker}>
            <Link href={`/c/${c.ticker}`} className="flex items-baseline gap-4 py-3.5 hover:text-accent">
              <span className="w-16 shrink-0 font-semibold">{c.ticker}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{c.name}</span>
              {c.valuation?.price != null && <span className="shrink-0 font-semibold tabular-nums">${c.valuation.price.toFixed(2)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
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
