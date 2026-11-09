"use client";

import Link from "next/link";
import { setWatched, useWatchlist } from "@/components/watchlist-store";
import { fmtDay, useWatchData } from "@/components/useWatchData";

/** Homepage watchlist: price, next earnings date, and a "see what changed" link right after a report. */
export default function WatchlistPanel() {
  const list = useWatchlist();
  const { items, alerts, loading } = useWatchData(list);
  return (
    <section className="mt-12">
      <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Your watchlist</h2>
      {!list.length ? (
        <p className="mt-3 text-sm text-muted">
          Tap <b className="text-foreground">☆ Watch</b> on any stock. You&apos;ll see its next earnings date here, and an alert (bell, top right) when it
          reports. Saved in this browser — no account needed.
        </p>
      ) : loading ? (
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-card" />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const a = alerts.find((x) => x.ticker === it.ticker);
            return (
              <li key={it.ticker} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5">
                <Link href={`/c/${it.ticker}`} className="w-16 shrink-0 font-semibold hover:underline">
                  {it.ticker}
                </Link>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{it.name}</span>
                <span className="text-sm">
                  {a?.kind === "reported" ? (
                    <Link href={`/c/${it.ticker}?tab=brief`} className="font-medium text-accent hover:underline">
                      Reported {fmtDay(a.date)}
                      {it.surprise != null && ` · ${it.surprise >= 0 ? "beat" : "missed"} by ${Math.abs(it.surprise * 100).toFixed(1)}%`} — see what changed →
                    </Link>
                  ) : it.nextReport ? (
                    <span className={a ? "font-medium" : "text-muted"}>{a?.kind === "today" ? "Reports today" : `Reports ${fmtDay(it.nextReport)}`}</span>
                  ) : (
                    <span className="text-muted">No date announced</span>
                  )}
                </span>
                <span className="w-28 text-right text-sm tabular-nums">
                  {it.price != null ? `$${it.price.toFixed(2)}` : ""}
                  {it.change != null && (
                    <span className={`ml-1.5 ${it.change >= 0 ? "text-up" : "text-down"}`}>
                      {it.change >= 0 ? "▲" : "▼"}
                      {Math.abs(it.change * 100).toFixed(1)}%
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setWatched(it.ticker, false)}
                  aria-label={`Remove ${it.ticker}`}
                  className="text-xs text-muted hover:text-foreground"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
