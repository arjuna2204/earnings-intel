"use client";

import Link from "next/link";
import MovePill from "@/components/MovePill";
import Sparkline from "@/components/Sparkline";
import { setWatched, useWatchlist } from "@/components/watchlist-store";
import { fmtDay, useWatchData } from "@/components/useWatchData";

/**
 * The visitor's watchlist as price rows: ticker, name and earnings status, sparkline, price, day's move.
 * `compact` (landing page) drops the remove buttons and the empty-state help.
 */
export default function WatchlistPanel({ compact = false }: { compact?: boolean }) {
  const list = useWatchlist();
  const { items, alerts, loading } = useWatchData(list);
  if (!list.length) {
    if (compact) return null;
    return (
      <div className="mt-6 rounded-2xl bg-card px-6 py-8">
        <p className="text-lg font-semibold">Nothing watched yet</p>
        <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-muted">
          Tap <b className="text-foreground">Watch</b> on any stock. It shows up here with its price and next earnings date, and the bell lights up the week it
          reports. Saved in this browser — no account needed.
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="mt-6 space-y-2">
        {list.slice(0, 4).map((t) => (
          <div key={t} className="skeleton h-14" />
        ))}
      </div>
    );
  }
  return (
    <ul className="mt-6">
      {items.map((it) => {
        const a = alerts.find((x) => x.ticker === it.ticker);
        const status =
          a?.kind === "reported"
            ? `Reported ${fmtDay(a.date)}${it.surprise != null ? ` · ${it.surprise >= 0 ? "beat" : "missed"} by ${Math.abs(it.surprise * 100).toFixed(1)}%` : ""}`
            : it.nextReport
              ? a?.kind === "today"
                ? "Reports today"
                : `Reports ${fmtDay(it.nextReport)}`
              : "No earnings date announced";
        return (
          <li key={it.ticker} className="group/row relative">
            <Link
              href={a?.kind === "reported" ? `/c/${it.ticker}?tab=earnings` : `/c/${it.ticker}`}
              className="row-link -mx-3 flex items-center gap-3 rounded-2xl px-3 py-3.5 sm:gap-6"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[17px] font-bold">{it.ticker}</span>
                  <span className="truncate text-[15px] text-muted">{it.name}</span>
                </span>
                <span className={`mt-0.5 block truncate text-[13px] ${a ? "font-medium text-foreground" : "text-muted"}`}>{status}</span>
              </span>
              <Sparkline values={it.spark ?? []} up={it.change == null ? undefined : it.change >= 0} width={96} height={32} className="hidden sm:block" />
              <span className="w-20 text-right text-[17px] font-semibold tabular-nums sm:w-24">{it.price != null ? `$${it.price.toFixed(2)}` : "—"}</span>
              <span className="w-[4.75rem] text-right">
                <MovePill v={it.change} />
              </span>
              {!compact && <span className="w-8" aria-hidden />}
            </Link>
            {!compact && (
              <button
                type="button"
                onClick={() => setWatched(it.ticker, false)}
                aria-label={`Stop watching ${it.ticker}`}
                title="Stop watching"
                className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-card-strong hover:text-foreground"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
