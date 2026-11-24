"use client";

import Link from "next/link";
import Reveal from "@/components/Reveal";
import WatchlistPanel from "@/components/WatchlistPanel";
import { useWatchlist } from "@/components/watchlist-store";

/** Landing page: the visitor's watched stocks, only when they watch something. */
export default function LandingMyStocks() {
  const list = useWatchlist();
  if (!list.length) return null;
  return (
    <Reveal className="mt-20 sm:mt-28" aria-labelledby="mine">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="mine" className="text-[28px] tracking-tight sm:text-[32px]">
          My stocks
        </h2>
        <Link href="/my-stocks" className="shrink-0 text-[15px] font-semibold text-accent-ink hover:underline">
          Watchlist & portfolio →
        </Link>
      </div>
      <WatchlistPanel compact />
    </Reveal>
  );
}
