"use client";

import { useState } from "react";
import type { DocHit } from "@/app/api/doc-search/route";

const SECTION: Record<string, string> = { business: "Business", risk_factors: "Risk factors", mdna: "Management's discussion", release: "Earnings release" };

function label(h: DocHit): string {
  if (h.kind === "call") return `Earnings call ${h.ref.replace(/^FY(\d{4})Q(\d)$/, "Q$2 FY$1")}${h.speaker ? ` · ${h.speaker}` : ""}`;
  const [form, sec] = h.section.split(" · ");
  return `${form === "8-K" ? "8-K" : form} · ${SECTION[sec] ?? sec}${h.doc_date ? ` · ${h.doc_date}` : ""}`;
}

/** Highlight the searched words; long passages are trimmed around the first match. */
function Passage({ text, q }: { text: string; q: string }) {
  const words = q
    .replace(/["']/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(or|and|not)$/i.test(w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let t = text;
  if (words.length) {
    const first = t.search(new RegExp(words.join("|"), "i"));
    if (t.length > 420 && first > 160) t = "…" + t.slice(first - 140);
    if (t.length > 420) t = t.slice(0, 420) + "…";
  }
  if (!words.length) return <>{t}</>;
  const parts = t.split(new RegExp(`(${words.join("|")}\\w*)`, "i"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded bg-accent/25 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Search what the company has said: its 10-K/10-Q sections, earnings releases and call transcripts. */
export default function DocSearch({ cik, ticker, filingLinks }: { cik: number; ticker: string; filingLinks: Record<string, string> }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DocHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/doc-search?cik=${cik}&q=${encodeURIComponent(q.trim())}`);
      const j = (await r.json()) as { hits?: DocHit[]; error?: string };
      if (!r.ok) throw new Error(j.error);
      setHits(j.hits ?? []);
    } catch {
      setError("Search failed. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };
  const secUrl = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(q.trim() ? `"${q.trim()}"` : "")}&ciks=${String(cik).padStart(10, "0")}`;
  return (
    <section aria-label="Search filings and calls">
      <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Search what {ticker} has said</h2>
      <form onSubmit={run} className="mt-4 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Try "tariffs", "AI", "buyback" or "China"'
          aria-label="Search words"
          className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy} className="rounded-full bg-accent px-5 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50">
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">
        Searches the 10-K and 10-Q sections, earnings releases and call transcripts stored here. Use quotes for an exact phrase.{" "}
        <a href={secUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-2 hover:underline">
          Search every SEC filing ↗
        </a>
      </p>
      {error && <p className="mt-4 text-sm text-down">{error}</p>}
      {hits && (
        <>
          <p className="mt-5 text-[15px]">
            {hits.length ? `${hits.length}${hits.length === 60 ? "+" : ""} passages mention it, newest first.` : "No passages found in the stored documents. Try other words, or search every SEC filing."}
          </p>
          <ul className="mt-3 divide-y divide-border">
            {hits.map((h, i) => (
              <li key={i} className="py-3">
                <div className="text-xs font-medium text-muted">
                  {h.kind === "filing" && filingLinks[h.ref] ? (
                    <a href={filingLinks[h.ref]} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
                      {label(h)} ↗
                    </a>
                  ) : (
                    label(h)
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed">
                  <Passage text={h.passage} q={q} />
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
