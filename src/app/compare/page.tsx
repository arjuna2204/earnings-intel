import { Suspense } from "react";
import type { Metadata } from "next";
import CompareView from "@/components/CompareView";
import { getCompareSide } from "@/lib/compare";

export const metadata: Metadata = { title: "Compare stocks" };

export default function ComparePage(props: PageProps<"/compare">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare two stocks</h1>
      <p className="mt-1 text-sm text-muted">Side by side: price, valuation, Street targets and fundamentals from SEC filings.</p>
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-card" />}>
        <CompareContent {...props} />
      </Suspense>
    </main>
  );
}

async function CompareContent({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const [a, b] = await Promise.all([getCompareSide(one(sp.a)), getCompareSide(one(sp.b))]);
  return <CompareView a={a} b={b} />;
}
