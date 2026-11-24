import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import SearchBox from "@/components/SearchBox";
import LandingMyStocks from "@/components/LandingMyStocks";
import MovePill from "@/components/MovePill";
import Reveal from "@/components/Reveal";
import Sparkline from "@/components/Sparkline";
import { recapDate } from "@/components/RecapLine";
import { select } from "@/lib/db";
import { recentRecaps, type Recap } from "@/lib/screener";

const TRY = ["AAPL", "NVDA", "MSFT", "JPM"];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      {/* 1. Headline, one-line promise, search */}
      <section className="mx-auto max-w-3xl pt-14 text-center sm:pt-24">
        <h1 className="text-balance text-[40px] leading-[1.02] tracking-[-0.04em] sm:text-[64px]">Equity research for the everyday investor</h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted">
          What changed this quarter, what the Street expects and what the stock could be worth — every number linked to its source.
        </p>
        <div className="mx-auto mt-9 max-w-xl text-left">
          <SearchBox large placeholder="Search any US-listed stock" />
        </div>
        <p className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
          <span>Try</span>
          {TRY.map((t) => (
            <Link key={t} href={`/c/${t}`} className="rounded-full bg-card px-3 py-1.5 font-semibold text-foreground hover:bg-card-strong">
              {t}
            </Link>
          ))}
        </p>
      </section>

      {/* 2. Three ways in */}
      <Reveal className="mt-20 sm:mt-28" aria-labelledby="ways">
        <h2 id="ways" className="sr-only">
          Where to start
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {INTENTS.map((c) => (
            <li key={c.title}>
              <Link href={c.href} className="lift group flex h-full flex-col rounded-2xl bg-card p-6">
                <span className="text-[22px] font-bold tracking-tight">{c.title}</span>
                <span className="mt-2 text-[15px] leading-relaxed text-muted">{c.text}</span>
                <span className="mt-auto flex items-center gap-1 pt-6 text-[15px] font-semibold text-accent-ink">
                  {c.cta}
                  <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Reveal>

      {/* 3. Reported this week */}
      <Reveal className="mt-20 sm:mt-28" aria-labelledby="reported">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="reported" className="text-[28px] tracking-tight sm:text-[32px]">
            Reported this week
          </h2>
          <Link href="/earnings" className="shrink-0 text-[15px] font-semibold text-accent-ink hover:underline">
            Full calendar →
          </Link>
        </div>
        <Suspense fallback={<RowsSkeleton />}>
          <Reported />
        </Suspense>
      </Reveal>

      {/* 4. How it works */}
      <Reveal className="mt-20 sm:mt-28" aria-labelledby="how">
        <h2 id="how" className="text-[28px] tracking-tight sm:text-[32px]">
          How it works
        </h2>
        <ol className="mt-8 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-[15px] font-bold text-background">
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-bold">{title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* 5. Why Earnings Intel */}
      <Reveal className="mt-20 rounded-3xl bg-card px-6 py-10 sm:mt-28 sm:px-10 sm:py-14" aria-labelledby="why">
        <h2 id="why" className="max-w-3xl text-balance text-[28px] leading-tight tracking-tight sm:text-[36px]">
          Finance sites show you the numbers. We explain what changed, why, and whether it matters.
        </h2>
        <dl className="mt-10 grid gap-8 sm:grid-cols-3">
          {WHY.map(([title, text]) => (
            <div key={title}>
              <dt className="text-[17px] font-bold">{title}</dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-muted">{text}</dd>
            </div>
          ))}
        </dl>
        <Link href="/about" className="mt-10 inline-flex rounded-full bg-foreground px-5 py-3 text-[15px] font-semibold text-background">
          Why Earnings Intel
        </Link>
      </Reveal>

      {/* 6. My stocks, only for visitors who watch something */}
      <LandingMyStocks />

      <p className="mt-20 text-center text-sm text-muted">
        Curious whether the signals work?{" "}
        <Link href="/backtest" className="font-semibold text-foreground hover:underline">
          See the backtest
        </Link>
        . Research, not investment advice.
      </p>
    </main>
  );
}

const INTENTS = [
  {
    title: "Just reported",
    text: "Your stock just put out results. See the beat or miss, the guidance, what management said on the call and how it compares with last year.",
    cta: "See this week's reports",
    href: "/earnings",
  },
  {
    title: "Thinking of buying",
    text: "Is it growing, is it expensive, how bumpy is the ride? One-line answers for every stock, each with the evidence behind it.",
    cta: "Find stocks to research",
    href: "/screener",
  },
  {
    title: "Building a pitch",
    text: "Bull, base and bear cases, a DCF you can download to Excel and the closest competitors side by side.",
    cta: "Compare companies",
    href: "/compare",
  },
];

const STEPS: [string, string][] = [
  ["Search a stock", "Any US-listed company. If it isn't loaded yet, one tap pulls 15 years of SEC filings and prices."],
  ["Read the one-line answers", "Every tab opens with its answer — Earnings, Valuation, Risk, Financials, Business — then the detail."],
  ["Check the source", "Tap a number to see the filing passage, call quote or SEC figure it came from."],
];

const WHY: [string, string][] = [
  ["What changed, not just what is", "Any two quarters compared: guidance, what drove the numbers, the call against the last one, new risk factors."],
  ["A source for every claim", "Every point links to the SEC filing or call quote it came from, so you can check it yourself."],
  ["Analyst math, free", "Adjusted figures, a downloadable DCF, bull / base / bear cases and peer comparison."],
];

/** Researched companies that reported in the last 7 days: price, sparkline and the day's move. */
async function Reported() {
  await connection(); // always live data
  let recaps: Recap[] = [];
  try {
    recaps = (await recentRecaps(7)).filter((r) => r.researched);
  } catch {
    recaps = [];
  }
  const seen = new Set<string>();
  const rows = recaps.filter((r) => (seen.has(r.ticker) ? false : (seen.add(r.ticker), true))).slice(0, 8);
  if (!rows.length) {
    return (
      <p className="mt-6 rounded-2xl bg-card px-6 py-8 text-[15px] text-muted">
        No researched company has reported in the last week.{" "}
        <Link href="/earnings" className="font-semibold text-foreground hover:underline">
          See who reports next
        </Link>
        .
      </p>
    );
  }
  const since = daysAgo(45);
  const px = await select<{ ticker: string; date: string; adj_close: number; close: number | null }>("prices", {
    ticker: `in.(${rows.map((r) => r.ticker).join(",")})`,
    date: `gte.${since}`,
    select: "ticker,date,adj_close,close",
    order: "date.asc",
  }).catch(() => []);
  const by = new Map<string, typeof px>();
  for (const p of px) by.set(p.ticker, [...(by.get(p.ticker) ?? []), p]);

  return (
    <ul className="mt-6">
      {rows.map((r) => {
        const series = (by.get(r.ticker) ?? []).slice(-22);
        const last = series.at(-1);
        const prev = series.at(-2);
        const day = last && prev ? last.adj_close / prev.adj_close - 1 : null;
        const price = last ? (last.close ?? last.adj_close) : null;
        return (
          <li key={r.ticker}>
            <Link href={`/c/${encodeURIComponent(r.ticker)}`} className="row-link -mx-3 flex items-center gap-3 rounded-2xl px-3 py-3.5 sm:gap-6">
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[17px] font-bold">{r.ticker}</span>
                  <span className="truncate text-[15px] text-muted">{r.name}</span>
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-muted">
                  Reported {recapDate(r.report_date)}
                  {r.eps_surprise != null && (
                    <>
                      {" · "}
                      {Math.abs(r.eps_surprise) < 0.0005 ? (
                        <span>in line with estimates</span>
                      ) : (
                        <span className={r.eps_surprise >= 0 ? "text-up-ink" : "text-down-ink"}>
                          {r.eps_surprise >= 0 ? "beat" : "missed"} by {Math.abs(r.eps_surprise * 100).toFixed(1)}%
                        </span>
                      )}
                    </>
                  )}
                </span>
              </span>
              <Sparkline values={series.map((p) => p.adj_close)} up={day == null ? undefined : day >= 0} width={96} height={32} className="hidden sm:block" />
              <span className="w-20 text-right text-[17px] font-semibold tabular-nums sm:w-24">{price != null ? `$${price.toFixed(2)}` : "—"}</span>
              <span className="w-[4.75rem] text-right">
                <MovePill v={day} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function RowsSkeleton() {
  return (
    <div className="mt-6 space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton h-14" />
      ))}
    </div>
  );
}
