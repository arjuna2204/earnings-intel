"use client";

import { useState } from "react";
import Term from "@/components/Term";

type Ev = { accession: string; date: string; url: string; items: string[]; summary: string | null; weight: "high" | "medium" | "routine" };

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Timeline of the company's 8-K filings: what happened, newest first. */
export default function EventsView({ events, labels }: { events: Ev[]; labels: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.filter((e) => e.weight !== "routine");
  const notable = events.filter((e) => e.weight === "high").length;
  return (
    <section aria-label="Company events">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-[17px] font-bold tracking-tight">
          <Term k="events_8k" quiet>Company events (8-Ks)</Term>
        </h3>
        <div className="flex gap-1" role="tablist">
          {[
            [false, "Notable"],
            [true, "Everything"],
          ].map(([v, l]) => (
            <button
              key={String(l)}
              role="tab"
              aria-selected={all === v}
              onClick={() => setAll(v as boolean)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${all === v ? "bg-foreground text-background" : "bg-card text-muted hover:text-foreground"}`}
            >
              {l as string}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[15px]">
        {events.length} filings with the SEC in the last two years
        {notable ? `; ${notable} flagged as significant (restatements, auditor changes, write-downs, restructurings and the like).` : ", none of the most serious kinds."}
      </p>
      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Nothing beyond routine filings (earnings releases, votes, presentations). Switch to Everything to see them.</p>
      ) : (
        <ol className="mt-4 divide-y divide-border">
          {shown.map((e) => (
            <li key={e.accession} className="grid grid-cols-[6.5rem_1fr] gap-3 py-3">
              <span className="pt-0.5 text-sm tabular-nums text-muted">{fmt(e.date)}</span>
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {e.weight === "high" && <span className="text-down-ink" aria-label="significant">●</span>}
                  {e.items.map((i) => (
                    <span key={i} className="font-semibold">
                      {labels[i] ?? `Item ${i}`}
                      <span className="mx-1.5 text-muted last:hidden">·</span>
                    </span>
                  ))}
                </div>
                {e.summary && <p className="mt-0.5 text-sm text-muted">{e.summary}</p>}
                <a href={e.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-xs text-muted underline-offset-2 hover:text-foreground hover:underline">
                  Read the 8-K ↗
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-muted">
        Source: SEC Form 8-K, the filing companies must make within four business days of a material event. The line under each event is the first
        sentence the company wrote about it.
      </p>
    </section>
  );
}
