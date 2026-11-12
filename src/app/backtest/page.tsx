import { connection } from "next/server";
import { Suspense } from "react";
import BacktestView, { type BacktestData } from "@/components/BacktestView";
import { select } from "@/lib/db";

export default function BacktestPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 pb-16 pt-8 *:max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">Backtest</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Did the app&apos;s signals come before the stock beating or lagging its sector? Each signal is checked across every company you&apos;ve
        loaded, using only information available on the day of the news.
      </p>
      <Suspense fallback={<div className="skeleton mt-8 h-96" />}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  await connection();
  const rows = await select<BacktestData>("backtest_results", { select: "summary,coverage,created_at", order: "created_at.desc", limit: "1" });
  if (!rows.length) {
    return (
      <p className="mt-10 text-muted">
        The first backtest hasn&apos;t finished yet. It runs every morning and grows its history within the free data limits.
      </p>
    );
  }
  return <BacktestView data={rows[0]} />;
}
