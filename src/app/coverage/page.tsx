import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import { selectAll } from "@/lib/db";

export const metadata: Metadata = { title: "What's ready to explore" };

const DAY = 24 * 3600 * 1000;

type Feature = "brief" | "call" | "peers" | "cases" | "dcf";
type Row = {
  ticker: string;
  name: string;
  features: Set<Feature>;
  transcripts: number;
  call: { a: string; b: string } | null;
  updated: string; // latest timestamp across everything pulled
  newest: Set<Feature | "loaded" | "transcripts">; // genuinely new in the last 24h (not daily refreshes)
};

const FEATURE_LABEL: Record<Feature, string> = {
  brief: "Brief",
  call: "Call analysis",
  peers: "Peers",
  cases: "Bull/base/bear",
  dcf: "DCF",
};

export default function CoveragePage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-16 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">What&apos;s ready to explore</h1>
      <p className="mt-1 text-sm text-muted">
        Companies with data already pulled, best first. Live — refreshed every morning at 6:17am ET and whenever someone loads a stock.
      </p>
      <Suspense fallback={<div className="mt-8 h-96 skeleton rounded-2xl" />}>
        <Report />
      </Suspense>
    </main>
  );
}

async function Report() {
  await connection();
  const [companies, transcripts, calls, briefs, peers, cases, dcfs] = await Promise.all([
    selectAll<{ cik: number; ticker: string; name: string; last_ingested_at: string | null; created_at: string }>("companies", {
      select: "cik,ticker,name,last_ingested_at,created_at",
    }),
    selectAll<{ cik: number; fetched_at: string }>("transcripts", { select: "cik,fetched_at" }),
    selectAll<{ cik: number; period_a: string; period_b: string; created_at: string }>("call_comparisons", {
      select: "cik,period_a,period_b,created_at",
      order: "created_at.asc",
    }),
    selectAll<{ cik: number; created_at: string }>("briefs", { select: "cik,created_at" }),
    selectAll<{ cik: number; created_at: string }>("peer_comparisons", { select: "cik,created_at" }),
    selectAll<{ cik: number; created_at: string }>("stock_cases", { select: "cik,created_at" }),
    selectAll<{ cik: number; status: string; created_at: string }>("dcf_models", { select: "cik,status,created_at" }),
  ]);

  const now = requestTime();
  const fresh = (iso: string | null | undefined) => !!iso && now - Date.parse(iso) < DAY;

  const rows = new Map<number, Row>();
  for (const c of companies) {
    rows.set(c.cik, {
      ticker: c.ticker,
      name: c.name,
      features: new Set(),
      transcripts: 0,
      call: null,
      updated: c.last_ingested_at ?? c.created_at,
      newest: new Set(fresh(c.created_at) ? ["loaded"] : []),
    });
  }
  const touch = (r: Row, iso: string) => {
    if (iso > r.updated) r.updated = iso;
  };
  for (const t of transcripts) {
    const r = rows.get(t.cik);
    if (r) {
      r.transcripts++;
      touch(r, t.fetched_at);
      if (fresh(t.fetched_at)) r.newest.add("transcripts");
    }
  }
  // DCF, cases and peers are re-run daily, so their timestamps don't mean "new"; briefs and call analyses are one-time
  const ONE_TIME: Feature[] = ["brief", "call"];
  const mark = (list: { cik: number; created_at: string }[], f: Feature) => {
    for (const x of list) {
      const r = rows.get(x.cik);
      if (!r) continue;
      r.features.add(f);
      touch(r, x.created_at);
      if (ONE_TIME.includes(f) && fresh(x.created_at)) r.newest.add(f);
    }
  };
  mark(calls, "call");
  for (const c of calls) {
    const r = rows.get(c.cik);
    if (r) r.call = { a: c.period_a, b: c.period_b }; // latest (ordered ascending)
  }
  mark(briefs, "brief");
  mark(peers, "peers");
  mark(cases, "cases");
  mark(
    dcfs.filter((d) => d.status === "ok"),
    "dcf",
  );

  const all = [...rows.values()];
  const full = all.filter((r) => r.features.has("brief") || r.features.has("call")).sort(byDepth);
  const valuation = all.filter((r) => !full.includes(r) && (r.features.has("peers") || r.features.has("cases"))).sort(byDepth);
  const basic = all.filter((r) => !full.includes(r) && !valuation.includes(r)).sort((x, y) => x.ticker.localeCompare(y.ticker));
  const recent = all.filter((r) => r.newest.size > 0).sort(byDepth);
  const asOf = new Date(now).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const shareText = [
    `Earnings Intel — what to try (as of ${asOf} ET)`,
    full.length ? `Full research (Brief + earnings-call analysis): ${full.map((r) => r.ticker).join(", ")}` : null,
    valuation.length ? `Peers + bull/base/bear cases: ${valuation.map((r) => r.ticker).join(", ")}` : null,
    basic.length ? `Financials, Street estimates & DCF: ${basic.map((r) => r.ticker).join(", ")}` : null,
    recent.length ? `New in the last day: ${recent.map((r) => r.ticker).join(", ")}` : null,
    "Tip: compare any two at /compare",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="mt-6 space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-4">
        <dl className="flex gap-8">
          <Stat label="Companies loaded" value={all.length} />
          <Stat label="Full research" value={full.length} />
          <Stat label="New in last day" value={recent.length} />
        </dl>
        <CopyButton text={shareText} label="Copy list for testers" />
      </div>

      {recent.length > 0 && (
        <Section title="New in the last day" note={`Newly loaded companies and new Briefs, call analyses or transcripts, up to ${asOf} ET.`}>
          {recent.map((r) => (
            <Item key={r.ticker} r={r} showNew />
          ))}
        </Section>
      )}

      <Section
        title="Full research"
        note="Best place to start: the Brief (what changed this quarter) and the earnings-call analysis are ready, plus everything below."
      >
        {full.length ? full.map((r) => <Item key={r.ticker} r={r} />) : <Empty />}
      </Section>

      <Section title="Peers & cases ready" note="Peer comparison and bull / base / bear cases, plus financials, Street estimates and the DCF.">
        {valuation.length ? valuation.map((r) => <Item key={r.ticker} r={r} />) : <Empty />}
      </Section>

      <Section
        title="Financials, Street estimates & DCF"
        note="15 years of SEC financials, Street estimates and the DCF. Opening the Brief or Call tab for these pulls new data (uses part of the daily allowance)."
      >
        {basic.map((r) => (
          <Item key={r.ticker} r={r} />
        ))}
      </Section>
    </div>
  );
}

/** Wall-clock time of this request (the page is dynamic: `connection()` above). */
function requestTime(): number {
  return Date.now();
}

function byDepth(x: Row, y: Row) {
  return y.features.size - x.features.size || y.transcripts - x.transcripts || x.ticker.localeCompare(y.ticker);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted">{note}</p>
      <ul className="mt-2 divide-y divide-border">{children}</ul>
    </section>
  );
}

function Empty() {
  return <li className="py-3 text-sm text-muted">None yet.</li>;
}

function Item({ r, showNew = false }: { r: Row; showNew?: boolean }) {
  const t = encodeURIComponent(r.ticker);
  const link = (f: Feature) =>
    f === "brief"
      ? `/c/${t}?tab=brief`
      : f === "call"
        ? `/c/${t}?tab=call${r.call ? `&a=${r.call.a}&b=${r.call.b}` : ""}`
        : f === "peers"
          ? `/c/${t}?tab=peers`
          : `/c/${t}?tab=street`;
  const order: Feature[] = ["brief", "call", "peers", "cases", "dcf"];
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 py-3">
      <Link href={`/c/${t}`} className="w-16 shrink-0 font-semibold hover:underline">
        {r.ticker}
      </Link>
      <span className="min-w-0 flex-1 truncate text-sm text-muted">{r.name}</span>
      <span className="flex flex-wrap gap-1.5">
        <Link href={`/c/${t}?tab=historical`} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:text-foreground">
          Financials
        </Link>
        {order
          .filter((f) => r.features.has(f))
          .map((f) => (
            <Link
              key={f}
              href={link(f)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${showNew && r.newest.has(f) ? "border-foreground font-medium" : "border-border text-muted hover:text-foreground"}`}
            >
              {FEATURE_LABEL[f]}
            </Link>
          ))}
        {showNew && r.newest.has("loaded") && <span className="rounded-full border border-foreground px-2.5 py-0.5 text-xs font-medium">Newly loaded</span>}
        {r.transcripts > 0 && (
          <span className={`px-1 text-xs ${showNew && r.newest.has("transcripts") ? "font-medium" : "text-muted"}`}>{r.transcripts} call transcripts</span>
        )}
      </span>
    </li>
  );
}
