"use client";

import { useState } from "react";
import Link from "next/link";
import SourcePanel from "@/components/SourcePanel";
import type { StreetRow } from "@/lib/figures";
import type { Brief, Fact } from "@/lib/filings";

const SECTION_TITLES: Record<string, string> = {
  headline: "What changed",
  street: "The Street view",
  results: "Results & drivers",
  guidance: "Guidance",
  call: "On the call",
  risks: "Risk factors",
  tensions: "Call vs. filing — worth a closer look",
};
const ORDER = ["headline", "street", "results", "guidance", "call", "risks", "tensions"];
const SOURCE_KIND: Record<string, string> = { X: "Financials", S: "Street", C: "Call", F: "Filing", R: "Risk factors" };


/** The brief: claims grouped by section, each with source chips that open the exact fact and quote. */
export default function BriefView({ brief, street, la, lb }: { brief: Brief; street: StreetRow[]; la: string; lb: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const facts = brief.inputs.facts;
  const fact = open ? facts[open] : null;
  const bySection = ORDER.map((s) => [s, brief.claims.filter((c) => c.section === s)] as const).filter(([, cs]) => cs.length);

  return (
    <div className="space-y-8">
      {street.length > 0 && <StreetScorecard rows={street} la={la} lb={lb} onSource={setOpen} />}
      {bySection.map(([section, claims]) => (
        <section key={section}>
          <h3 className={`mb-3 font-semibold ${section === "headline" ? "text-xl" : "text-lg"}`}>{SECTION_TITLES[section]}</h3>
          <ul className={section === "headline" ? "space-y-3" : "space-y-2.5"}>
            {claims.map((c, i) => (
              <li
                key={i}
                className={
                  section === "headline"
                    ? "rounded-2xl border border-border bg-card p-4 text-base leading-relaxed"
                    : section === "tensions"
                      ? "rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 leading-relaxed"
                      : "leading-relaxed"
                }
              >
                {section !== "headline" && section !== "tensions" && <span className="mr-2 text-muted">•</span>}
                {c.text}{" "}
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  {c.refs.map((r) => (
                    <button
                      key={r}
                      onClick={() => setOpen(r)}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition hover:border-accent hover:text-foreground"
                      aria-label={`Source ${r}: ${SOURCE_KIND[r[0]] ?? "source"}`}
                    >
                      {SOURCE_KIND[r[0]] ?? r[0]} {r.slice(1)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted">
        Written by AI only from the facts listed in Sources, then checked by code: every citation must exist and every number must
        appear in a cited fact. {brief.dropped?.length ? `${brief.dropped.length} claim(s) failed the check and were removed. ` : ""}
        Cost ${Number(brief.cost_usd).toFixed(3)} · {new Date(brief.created_at).toLocaleDateString()}
      </p>
      <details className="rounded-2xl border border-border p-4 text-sm">
        <summary className="cursor-pointer font-medium">All {Object.keys(facts).length} facts the brief could use</summary>
        <ul className="mt-3 space-y-1.5">
          {Object.entries(facts).map(([id, f]) => (
            <li key={id}>
              <button onClick={() => setOpen(id)} className="text-left hover:text-accent">
                <span className="mr-2 font-mono text-xs text-muted">{id}</span>
                {f.text.length > 220 ? f.text.slice(0, 217) + "…" : f.text}
              </button>
            </li>
          ))}
        </ul>
      </details>
      {fact && open && (
        <SourcePanel title={`${SOURCE_KIND[open[0]] ?? "Source"} · ${open}`} onClose={() => setOpen(null)}>
          <FactDetail fact={fact} />
        </SourcePanel>
      )}
    </div>
  );
}

function FactDetail({ fact }: { fact: Fact }) {
  const quote = fact.quote && !fact.text.includes(fact.quote) ? fact.quote : null;
  return (
    <>
      <p className="leading-relaxed">{fact.text}</p>
      {quote && <blockquote className="border-l-2 border-accent pl-3 italic leading-relaxed">“{quote}”</blockquote>}
      {fact.link_label && (
        <p className="text-muted">
          Source:{" "}
          {fact.link ? (
            fact.link.startsWith("?") ? (
              <Link href={fact.link} className="text-accent underline">
                {fact.link_label}
              </Link>
            ) : (
              <a href={fact.link} target="_blank" rel="noreferrer" className="text-accent underline">
                {fact.link_label} ↗
              </a>
            )
          ) : (
            fact.link_label
          )}
        </p>
      )}
    </>
  );
}

function StreetScorecard({ rows, la, lb, onSource }: { rows: StreetRow[]; la: string; lb: string; onSource: (id: string) => void }) {
  return (
    <section className="rounded-2xl border border-border p-4 sm:p-5">
      <h3 className="mb-1 text-lg font-semibold">Street scorecard</h3>
      <p className="mb-3 text-xs text-muted">The figures analysts compare: company-reported (GAAP and adjusted), consensus, and this app&apos;s standardized adjusted.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">Metric</th>
              <th className="py-1.5 pr-3 text-right font-medium">{la}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{lb}</th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-2 pr-3">
                  {r.label}
                  {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.a}</td>
                <td className={`py-2 pr-3 text-right font-medium tabular-nums ${r.tone === "up" ? "text-up" : r.tone === "down" ? "text-down" : ""}`}>
                  {r.tone === "up" ? "▲ " : r.tone === "down" ? "▼ " : ""}
                  {r.b}
                </td>
                <td className="py-2 text-right">
                  {r.ref && (
                    <button onClick={() => onSource(r.ref!)} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:text-foreground">
                      source
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
