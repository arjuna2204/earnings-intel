import type { Metadata } from "next";
import PortfolioView from "@/components/PortfolioView";
import WatchlistPanel from "@/components/WatchlistPanel";

export const metadata: Metadata = { title: "My stocks" };

/** Watchlist and portfolio together. Both live in the visitor's browser; no account. */
export default function MyStocksPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-8 sm:pt-12">
      <h1 className="text-[32px] tracking-tight sm:text-[40px]">My stocks</h1>
      <p className="mt-2 max-w-2xl text-[15px] text-muted">Saved in this browser only — no account needed.</p>

      <section id="watchlist" className="mt-10 scroll-mt-24" aria-labelledby="wl">
        <h2 id="wl" className="text-[22px]">
          Watchlist
        </h2>
        <WatchlistPanel />
      </section>

      <section id="portfolio" className="mt-16 scroll-mt-24" aria-labelledby="pf">
        <h2 id="pf" className="text-[22px]">
          Portfolio
        </h2>
        <p className="mt-1 text-[15px] text-muted">See what you own as a whole: sectors, where the sales come from, dividend income, risk and who reports next.</p>
        <PortfolioView />
      </section>
    </main>
  );
}
