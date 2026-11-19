import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Term from "@/components/Term";
import { RecapFacts, recapDate } from "@/components/RecapLine";
import { recentRecaps, upcomingEarnings, type CalendarRow, type Recap } from "@/lib/screener";

export const metadata: Metadata = { title: "Earnings this week" };

const SHOW = 12; // per day before "show all"

export default function EarningsPage(props: PageProps<"/earnings">) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-16 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Earnings this week</h1>
      <p className="mt-1 text-sm text-muted">
        Who reports in the next 7 days, largest companies first. Dates are scheduled, not confirmed; companies sometimes move them.
      </p>
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-card" />}>
        <Calendar {...props} />
      </Suspense>
    </main>
  );
}

function dayLabel(d: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const label = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  return d === today ? `Today · ${label}` : d === tomorrow ? `Tomorrow · ${label}` : label;
}

async function Calendar({ searchParams }: PageProps<"/earnings">) {
  const sp = await searchParams;
  const mine = sp.mine === "1";
  let rows: CalendarRow[];
  let recaps: Recap[];
  try {
    [rows, recaps] = await Promise.all([upcomingEarnings(7), recentRecaps(7)]);
  } catch {
    return <p className="mt-8 text-sm text-muted">The earnings calendar couldn&apos;t load. Try again in a minute.</p>;
  }
  if (mine) {
    rows = rows.filter((r) => r.loaded);
    recaps = recaps.filter((r) => r.researched);
  }
  // researched companies first, then the biggest moves
  recaps.sort((a, b) => b.report_date.localeCompare(a.report_date) || Number(b.researched) - Number(a.researched) || Math.abs(b.move ?? 0) - Math.abs(a.move ?? 0));
  const days = [...new Set(rows.map((r) => r.date))];
  const loadedCount = rows.filter((r) => r.loaded).length;

  return (
    <>
      <div className="mt-5 flex gap-1 text-sm" role="tablist" aria-label="Which companies">
        <Link
          href="/earnings"
          role="tab"
          aria-selected={!mine}
          className={`rounded-full px-3 py-1.5 font-medium ${!mine ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"}`}
        >
          All companies
        </Link>
        <Link
          href="/earnings?mine=1"
          role="tab"
          aria-selected={mine}
          className={`rounded-full px-3 py-1.5 font-medium ${mine ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"}`}
        >
          Researched here{!mine && loadedCount ? ` (${loadedCount})` : ""}
        </Link>
      </div>

      {recaps.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-baseline justify-between border-b border-border pb-2">
            <span className="font-semibold">Just reported</span>
            <span className="text-xs text-muted">last 7 days · {recaps.length}</span>
          </h2>
          <RecapRows rows={recaps.slice(0, SHOW)} />
          {recaps.length > SHOW && (
            <details className="group">
              <summary className="cursor-pointer list-none py-2 text-sm font-medium text-muted hover:text-foreground">
                <span className="group-open:hidden">Show all {recaps.length}</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <RecapRows rows={recaps.slice(SHOW)} />
            </details>
          )}
          <p className="mt-2 text-xs text-muted">
            Stock move: close before the report date to the close of the first trading day after it, so it covers both before-the-open and
            after-the-close reports. Expected move: what options priced in beforehand (researched companies).
          </p>
        </section>
      )}

      <h2 className="mt-10 text-lg font-semibold">Coming up</h2>
      {days.length === 0 && (
        <p className="mt-8 text-sm text-muted">
          {mine ? "None of the companies researched here report in the next 7 days." : "No scheduled reports in the next 7 days."}
        </p>
      )}

      {days.map((d) => {
        const list = rows.filter((r) => r.date === d);
        return (
          <section key={d} className="mt-8">
            <h2 className="flex items-baseline justify-between border-b border-border pb-2">
              <span className="font-semibold">{dayLabel(d)}</span>
              <span className="text-xs text-muted">{list.length} reporting</span>
            </h2>
            <Rows rows={list.slice(0, SHOW)} />
            {list.length > SHOW && (
              <details className="group">
                <summary className="cursor-pointer list-none py-2 text-sm font-medium text-muted hover:text-foreground">
                  <span className="group-open:hidden">Show all {list.length}</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                </summary>
                <Rows rows={list.slice(SHOW)} />
              </details>
            )}
          </section>
        );
      })}

      <p className="mt-10 text-xs text-muted">
        Dates and EPS estimates: Alpha Vantage earnings calendar, refreshed each weekday morning. Expected moves come from listed options
        (Cboe, delayed) and appear only for companies researched here.
      </p>
    </>
  );
}

function RecapRows({ rows }: { rows: Recap[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={`${r.ticker}-${r.report_date}`} className="py-3">
          <div className="flex items-baseline gap-2">
            <a href={`/c/${encodeURIComponent(r.ticker)}`} className="font-semibold hover:underline">
              {r.ticker}
            </a>
            <span className="truncate text-sm text-muted">{r.name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted">{recapDate(r.report_date)}</span>
          </div>
          <div className="mt-1">
            <RecapFacts r={r} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Rows({ rows }: { rows: CalendarRow[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.ticker} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{r.ticker}</span>
              <span className="truncate text-sm text-muted">{r.name}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted tabular-nums">
              {r.epsEstimate != null && (
                <span>
                  <Term k="consensus_eps">EPS est.</Term> ${r.epsEstimate.toFixed(2)}
                </span>
              )}
              {r.expectedMove != null && (
                <span>
                  <Term k="earnings_day_move">Options expect</Term> ±{(r.expectedMove * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <Link
            href={`/c/${encodeURIComponent(r.ticker)}`}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${r.loaded ? "bg-card hover:bg-border" : "text-muted hover:text-foreground"}`}
          >
            {r.loaded ? "Research" : "Load"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
