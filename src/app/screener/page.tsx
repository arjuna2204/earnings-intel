import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import ScreenerView from "@/components/ScreenerView";
import { screenRows } from "@/lib/screener";

export const metadata: Metadata = { title: "Stock screener" };

export default function ScreenerPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 pb-16 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Screener</h1>
      <p className="mt-1 text-sm text-muted">Filter and sort the 500 largest US companies by valuation, growth, quality and risk.</p>
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-card" />}>
        <Rows />
      </Suspense>
    </main>
  );
}

async function Rows() {
  await connection();
  const rows = await screenRows().catch(() => null);
  if (!rows) return <p className="mt-8 text-sm text-muted">The screener couldn&apos;t load. Try again in a minute.</p>;
  return <ScreenerView rows={rows} />;
}
