"use client";

import { setWatched, useWatchlist } from "@/components/watchlist-store";
import Icon from "@/components/Icon";

export default function WatchButton({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const on = useWatchlist().includes(ticker);
  return (
    <button
      type="button"
      onClick={() => setWatched(ticker, !on)}
      aria-pressed={on}
      title={on ? "Remove from your watchlist" : "Add to your watchlist — get an alert here when it reports earnings"}
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${compact ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-sm"} ${
        on ? "bg-up/15 text-up-ink" : "bg-foreground text-background"
      }`}
    >
      <Icon name="star" filled={on} />
      {on ? "Watching" : "Watch"}
    </button>
  );
}
