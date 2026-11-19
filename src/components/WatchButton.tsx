"use client";

import { setWatched, useWatchlist } from "@/components/watchlist-store";

export default function WatchButton({ ticker }: { ticker: string }) {
  const on = useWatchlist().includes(ticker);
  return (
    <button
      type="button"
      onClick={() => setWatched(ticker, !on)}
      aria-pressed={on}
      title={on ? "Remove from your watchlist" : "Add to your watchlist — get an alert here when it reports earnings"}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${on ? "border-accent/40 bg-accent/15 text-accent" : "border-border hover:bg-card"}`}
    >
      {on ? "★ Watching" : "☆ Watch"}
    </button>
  );
}
