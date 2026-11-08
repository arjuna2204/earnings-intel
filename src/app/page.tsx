import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import SearchBox from "@/components/SearchBox";
import { select } from "@/lib/db";
import type { Company } from "@/lib/types";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-16 pt-16 sm:pt-24">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">What changed?</h1>
      <p className="mt-3 text-lg text-muted">
        Earnings calls, SEC filings and 15 years of financials — every number linked to its source.
      </p>
      <div className="mt-8">
        <SearchBox autoFocus large />
      </div>
      <Suspense fallback={<RecentSkeleton />}>
        <Recent />
      </Suspense>
    </main>
  );
}

async function Recent() {
  await connection(); // always live data
  let rows: Pick<Company, "ticker" | "name" | "last_ingested_at">[] = [];
  try {
    rows = await select("companies", {
      select: "ticker,name,last_ingested_at",
      is_primary: "eq.true",
      order: "last_ingested_at.desc.nullslast",
      limit: "12",
    });
  } catch {
    return (
      <p className="mt-10 text-sm text-muted">
        Can&apos;t reach the database. Open{" "}
        <a href="/api/health" className="text-accent underline">
          the setup check
        </a>{" "}
        to see which setting needs fixing.
      </p>
    );
  }
  if (!rows.length) return <p className="mt-10 text-sm text-muted">No companies loaded yet — search for one to start.</p>;
  return (
    <section className="mt-12">
      <h2 className="text-sm font-semibold text-muted">Your companies</h2>
      <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
        {rows.map((c) => (
          <li key={c.ticker}>
            <Link href={`/c/${c.ticker}`} className="flex items-baseline gap-4 px-5 py-3.5 hover:bg-card">
              <span className="w-16 font-semibold">{c.ticker}</span>
              <span className="truncate text-muted">{c.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentSkeleton() {
  return (
    <div className="mt-12 space-y-2">
      <div className="skeleton h-4 w-32" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton h-12" />
      ))}
    </div>
  );
}
