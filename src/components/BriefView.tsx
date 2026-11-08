"use client";

import { useState } from "react";
import Link from "next/link";
import SourcePanel from "@/components/SourcePanel";
import type { StreetRow } from "@/lib/figures";
import type { Brief, Claim, Fact } from "@/lib/filings";
import type { Bridge, BriefExtras, StreakItem, Tile, Tone } from "@/lib/brief-extras";
import type { GuidanceChange, GuidanceItem } from "@/lib/types";

const SOURCE_KIND: Record<string, string> = { X: "Financials", S: "Street", C: "Call", F: "Filing", R: "Risk factors" };
const TONE_TEXT: Record<Tone, string> = { up: "text-up", down: "text-down", neutral: "text-muted", warn: "text-amber-600 dark:text-amber-400" };
const TONE_CHIP: Record<Tone, string> = {
  up: "bg-up/12 text-up border-up/30",
  down: "bg-down/12 text-down border-down/30",
  neutral: "bg-card text-foreground border-border",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
};
const ARROW: Record<Tone, string> = { up: "▲", down: "▼", neutral: "◆", warn: "⚠" };

type SectionKey = "street" | "tensions" | "guidance" | "results" | "call" | "risks";

/** The brief, laid out for a 30-second read first and drill-down second. */
export default function BriefView({
  brief,
  street,
  extras,
  la,
  lb,
}: {
  brief: Brief;
  street: StreetRow[];
  extras: BriefExtras;
  la: string;
  lb: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<SectionKey>>(new Set(["street"]));
  const facts = brief.inputs.facts;
  const claims = (s: string) => brief.claims.filter((c) => c.section === s);
  const toggle = (k: SectionKey, force?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (force ?? !next.has(k)) next.add(k);
      else next.delete(k);
      return next;
    });
  const jump = (k: string) => {
    toggle(k as SectionKey, true);
    requestAnimationFrame(() => document.getElementById(`brief-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const chips = (c: Claim) => <SourceChips refs={c.refs} onOpen={setOpen} />;
  const c = extras.counts;

  return (
    <div className="space-y-5">
      {/* 30-second verdict */}
      {extras.verdict.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Verdict">
          {extras.verdict.map((v, i) => (
            <button key={i} onClick={() => jump(v.target)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition hover:brightness-110 ${TONE_CHIP[v.tone]}`}>
              {ARROW[v.tone]} {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Headline claims */}
      {claims("headline").length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {claims("headline").map((cl, i) => (
            <div key={i} className={`rounded-2xl border border-border bg-card p-4 leading-relaxed ${i === 0 ? "md:col-span-2 text-lg" : ""}`}>
              {cl.text} {chips(cl)}
            </div>
          ))}
        </div>
      )}

      <Section
        id="street"
        title="The Street view"
        teaser={[extras.verdict.find((v) => v.target === "street")?.label, extras.bridge ? "GAAP → adjusted bridge" : null, `${extras.streak.length}-quarter beat history`].filter(Boolean).join(" · ")}
        open={expanded.has("street")}
        onToggle={() => toggle("street")}
      >
        {extras.tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {extras.tiles.map((t, i) => (
              <StatTile key={i} tile={t} />
            ))}
          </div>
        )}
        {extras.streak.length > 1 && <Streak items={extras.streak} />}
        {extras.bridge && <BridgeChart bridge={extras.bridge} lb={lb} />}
        <ClaimList claims={claims("street")} chips={chips} />
        {street.length > 0 && (
          <details className="rounded-2xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium">Full Street scorecard</summary>
            <Scorecard rows={street} la={la} lb={lb} onSource={setOpen} />
          </details>
        )}
      </Section>

      {claims("tensions").length > 0 && (
        <Section
          id="tensions"
          title="Worth a closer look"
          teaser={`${claims("tensions").length} place${claims("tensions").length > 1 ? "s" : ""} where the call and the filing don't line up`}
          open={expanded.has("tensions")}
          onToggle={() => toggle("tensions")}
          accent
        >
          {claims("tensions").map((cl, i) => (
            <Tension key={i} claim={cl} facts={facts} onOpen={setOpen} />
          ))}
        </Section>
      )}

      {(claims("guidance").length > 0 || extras.guidance.length > 0) && (
        <Section
          id="guidance"
          title="Guidance"
          teaser={[c.raised && `${c.raised} raised`, c.lowered && `${c.lowered} cut`, c.added && `${c.added} new`, c.dropped && `${c.dropped} quietly dropped`].filter(Boolean).join(" · ") || "No changes"}
          open={expanded.has("guidance")}
          onToggle={() => toggle("guidance")}
        >
          <GuidanceBars items={extras.guidance} la={la} lb={lb} />
          <ClaimList claims={claims("guidance")} chips={chips} />
        </Section>
      )}

      {claims("results").length > 0 && (
        <Section id="results" title="Results & what drove them" teaser={claims("results")[0].text} open={expanded.has("results")} onToggle={() => toggle("results")}>
          <ClaimList claims={claims("results")} chips={chips} cards />
        </Section>
      )}

      {claims("call").length > 0 && (
        <Section id="call" title="On the call" teaser={claims("call")[0].text} open={expanded.has("call")} onToggle={() => toggle("call")}>
          <ClaimList claims={claims("call")} chips={chips} />
          <Link href={`?tab=call&a=${la}&b=${lb}`} className="inline-block text-sm text-accent underline">
            Open the full call comparison →
          </Link>
        </Section>
      )}

      {claims("risks").length > 0 && (
        <Section
          id="risks"
          title="Risk factors"
          teaser={[c.riskAdded && `${c.riskAdded} added`, c.riskRemoved && `${c.riskRemoved} removed`, c.escalated && `${c.escalated} with escalated language`].filter(Boolean).join(" · ")}
          open={expanded.has("risks")}
          onToggle={() => toggle("risks")}
        >
          <ClaimList claims={claims("risks")} chips={chips} cards warn />
          <Link href={`?tab=filings&a=${la}&b=${lb}`} className="inline-block text-sm text-accent underline">
            See the full redline →
          </Link>
        </Section>
      )}

      <p className="pt-2 text-xs text-muted">
        Written by AI only from the facts listed below, then checked by code: every citation must exist and every number must appear in a
        cited fact. {brief.dropped?.length ? `${brief.dropped.length} claim(s) failed the check and were removed. ` : ""}Charts and tiles are
        computed by code. Cost ${Number(brief.cost_usd).toFixed(3)} · {new Date(brief.created_at).toLocaleDateString()}
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
      {open && facts[open] && (
        <SourcePanel title={`${SOURCE_KIND[open[0]] ?? "Source"} · ${open}`} onClose={() => setOpen(null)}>
          <FactDetail fact={facts[open]} />
        </SourcePanel>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  teaser,
  open,
  onToggle,
  accent,
  children,
}: {
  id: string;
  title: string;
  teaser: string;
  open: boolean;
  onToggle: () => void;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={`brief-${id}`} className={`scroll-mt-20 rounded-2xl border ${accent ? "border-amber-500/40 bg-amber-500/[0.04]" : "border-border"}`}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <span className="flex-1">
          <span className="block text-lg font-semibold">{title}</span>
          {!open && <span className="mt-0.5 line-clamp-1 block text-sm text-muted">{teaser}</span>}
        </span>
        <span className={`text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden>
          ⌄
        </span>
      </button>
      {open && <div className="space-y-5 px-4 pb-5 sm:px-5">{children}</div>}
    </section>
  );
}

function SourceChips({ refs, onOpen }: { refs: string[]; onOpen: (id: string) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {refs.map((r) => (
        <button
          key={r}
          onClick={() => onOpen(r)}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition hover:border-accent hover:text-foreground"
          aria-label={`Source ${r}: ${SOURCE_KIND[r[0]] ?? "source"}`}
        >
          {SOURCE_KIND[r[0]] ?? r[0]} {r.slice(1)}
        </button>
      ))}
    </span>
  );
}

function ClaimList({ claims, chips, cards, warn }: { claims: Claim[]; chips: (c: Claim) => React.ReactNode; cards?: boolean; warn?: boolean }) {
  if (!claims.length) return null;
  if (cards) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {claims.map((c, i) => (
          <div key={i} className={`rounded-xl border p-3.5 text-sm leading-relaxed ${warn ? "border-amber-500/30" : "border-border"}`}>
            {warn && <span className="mr-1 text-amber-600 dark:text-amber-400">⚠</span>}
            {c.text} {chips(c)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <ul className="space-y-2 text-sm leading-relaxed">
      {claims.map((c, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted">•</span>
          <span>
            {c.text} {chips(c)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatTile({ tile }: { tile: Tile }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-xs text-muted">{tile.label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</div>
      <div className={`mt-1 text-xs font-medium ${TONE_TEXT[tile.tone]}`}>
        {tile.tone !== "neutral" && `${ARROW[tile.tone]} `}
        {tile.sub}
      </div>
    </div>
  );
}

function Streak({ items }: { items: StreakItem[] }) {
  const max = Math.max(...items.map((i) => Math.abs(i.surprisePct)), 1);
  const beats = items.filter((i) => i.surprisePct >= 0).length;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">Beat / miss history</span>
        <span className="text-xs text-muted">
          Beat {beats} of last {items.length} quarters
        </span>
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 88 }}>
        {items.map((it) => {
          const h = Math.max((Math.abs(it.surprisePct) / max) * 60, 4);
          const up = it.surprisePct >= 0;
          return (
            <div key={it.label} className="group relative flex flex-1 flex-col items-center justify-end" title={`${it.label}: $${it.reported.toFixed(2)} vs $${it.estimated.toFixed(2)} (${up ? "+" : ""}${it.surprisePct.toFixed(1)}%)`}>
              <span className={`text-[10px] font-semibold tabular-nums ${up ? "text-up" : "text-down"}`}>
                {up ? "+" : ""}
                {it.surprisePct.toFixed(1)}%
              </span>
              <div className={`mt-0.5 w-full max-w-10 rounded-md ${up ? "bg-up" : "bg-down"}`} style={{ height: h }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {items.map((it) => (
          <span key={it.label} className="flex-1 text-center text-[10px] text-muted">
            {it.label.replace(/^FY(\d{2})(\d{2})/, "’$2 ")}
          </span>
        ))}
      </div>
    </div>
  );
}

function BridgeChart({ bridge, lb }: { bridge: Bridge; lb: string }) {
  const fmt = (v: number) =>
    bridge.unit === "per share" ? `$${v.toFixed(2)}` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(0)}M`;
  const fmtD = (v: number) => `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v))}`;
  // running totals (computed without mutation)
  const cumulative = bridge.steps.map((_, i) => bridge.start + bridge.steps.slice(0, i + 1).reduce((t, x) => t + x.value, 0));
  const rows = [
    { label: bridge.startLabel, from: 0, to: bridge.start, kind: "total" as const, text: fmt(bridge.start) },
    ...bridge.steps.map((s, i) => ({
      label: s.label + (s.computed ? " (computed)" : ""),
      from: i === 0 ? bridge.start : cumulative[i - 1],
      to: cumulative[i],
      kind: s.value >= 0 ? ("add" as const) : ("sub" as const),
      text: fmtD(s.value),
    })),
    { label: bridge.endLabel, from: 0, to: bridge.end, kind: "total" as const, text: fmt(bridge.end) },
  ];
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to)));
  const hi = Math.max(...rows.map((r) => Math.max(r.from, r.to)));
  // zoom in so small adjustments are visible: start the axis near the smaller total
  const base = Math.max(lo, Math.min(bridge.start, bridge.end) - (hi - Math.min(bridge.start, bridge.end)) * 1.5 - Math.abs(hi) * 0.02);
  const span = hi - base || 1;
  const pos = (v: number) => ((Math.max(v, base) - base) / span) * 100;
  return (
    <div>
      <div className="mb-1 text-sm font-semibold">From GAAP to adjusted ({bridge.basis.toLowerCase()}, {lb})</div>
      <p className="mb-3 text-xs text-muted">What the company excludes to get the number the Street uses. Bars start near the smaller total so small items are visible.</p>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const left = pos(Math.min(r.from, r.to));
          const width = Math.max(pos(Math.max(r.from, r.to)) - left, 0.8);
          const color = r.kind === "total" ? "bg-foreground/70" : r.kind === "add" ? "bg-up" : "bg-down";
          return (
            <div key={i} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr_auto]">
              <span className={`truncate ${r.kind === "total" ? "font-semibold" : "text-muted"}`} title={r.label}>
                {r.label}
              </span>
              <div className="relative h-5 rounded bg-border/40">
                <div className={`absolute top-0 h-5 rounded ${color}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
              <span className={`w-20 text-right tabular-nums ${r.kind === "total" ? "font-semibold" : r.kind === "add" ? "text-up" : "text-down"}`}>{r.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function rangeOf(g: GuidanceItem | null): [number, number] | null {
  if (!g) return null;
  if (g.low != null && g.high != null) return [g.low, g.high];
  if (g.point != null) return [g.point, g.point];
  return null;
}

function GuidanceBars({ items, la, lb }: { items: GuidanceChange[]; la: string; lb: string }) {
  const numeric = items.filter((g) => rangeOf(g.earlier) && rangeOf(g.later) && g.earlier?.unit === g.later?.unit);
  const other = items.filter((g) => !numeric.includes(g) && g.change !== "maintained");
  const unitText = (u: string | null | undefined, v: number) => {
    if (!u) return `${v}`;
    if (u.includes("%") || u.toLowerCase().includes("percent")) return `${v}%`;
    if (u.toLowerCase().includes("billion")) return `$${v}B`;
    if (u.toLowerCase().includes("million")) return `$${v}M`;
    if (u.toLowerCase().includes("usd")) return `$${v}`;
    return `${v} ${u}`;
  };
  const rangeText = (r: [number, number], u: string | null | undefined) => (r[0] === r[1] ? unitText(u, r[0]) : `${unitText(u, r[0])}–${unitText(u, r[1])}`);
  const changeTone: Record<string, Tone> = { raised: "up", lowered: "down", new: "neutral", withdrawn: "down", "not repeated": "warn" };
  return (
    <div className="space-y-5">
      {numeric.length > 0 && (
        <div className="space-y-4">
          <div className="flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-5 rounded bg-muted/50" /> {la} call
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-5 rounded bg-accent" /> {lb} call
            </span>
          </div>
          {numeric.map((g, i) => {
            const a = rangeOf(g.earlier)!;
            const b = rangeOf(g.later)!;
            const lo = Math.min(a[0], b[0]);
            const hi = Math.max(a[1], b[1]);
            const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
            const [min, max] = [lo - pad, hi + pad];
            const pos = (v: number) => ((v - min) / (max - min)) * 100;
            const bar = (r: [number, number], cls: string) => (
              <div className="relative h-3 rounded bg-border/40">
                <div className={`absolute top-0 h-3 rounded ${cls}`} style={{ left: `${pos(r[0])}%`, width: `${Math.max(pos(r[1]) - pos(r[0]), 1.5)}%` }} />
              </div>
            );
            const tone = changeTone[g.change] ?? "neutral";
            return (
              <div key={i}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {g.metric}
                    {g.later?.period && <span className="ml-1 text-xs text-muted">({g.later.period})</span>}
                  </span>
                  <span className={`text-xs font-semibold uppercase ${TONE_TEXT[tone]}`}>
                    {ARROW[tone]} {g.change}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
                  {bar(a, "bg-muted/50")}
                  <span className="w-28 text-right tabular-nums text-muted">{rangeText(a, g.earlier?.unit)}</span>
                  {bar(b, "bg-accent")}
                  <span className="w-28 text-right font-semibold tabular-nums">{rangeText(b, g.later?.unit)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {other.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {other.map((g, i) => {
            const tone = changeTone[g.change] ?? "neutral";
            const q = (g.later ?? g.earlier)?.quote;
            return (
              <span key={i} title={q ? `“${q}”` : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${TONE_CHIP[tone]}`}>
                {g.change === "not repeated" ? "Quietly dropped" : g.change === "new" ? "New" : g.change.charAt(0).toUpperCase() + g.change.slice(1)}: {g.metric}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tension({ claim, facts, onOpen }: { claim: Claim; facts: Record<string, Fact>; onOpen: (id: string) => void }) {
  const said = claim.refs.filter((r) => r.startsWith("C"));
  const shows = claim.refs.filter((r) => !r.startsWith("C"));
  const snippet = (id: string) => {
    const f = facts[id];
    if (!f) return id;
    const q = f.quote && f.quote.length < 260 ? `“${f.quote}”` : f.text.length > 200 ? f.text.slice(0, 197) + "…" : f.text;
    return q;
  };
  return (
    <div className="space-y-3">
      <p className="leading-relaxed">{claim.text}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-background p-3.5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Said on the call</div>
          {said.map((id) => (
            <button key={id} onClick={() => onOpen(id)} className="mb-2 block text-left text-sm leading-relaxed hover:text-accent">
              {snippet(id)}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-background p-3.5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">What the filing &amp; numbers show</div>
          {shows.map((id) => (
            <button key={id} onClick={() => onOpen(id)} className="mb-2 block text-left text-sm leading-relaxed hover:text-accent">
              {snippet(id)}
            </button>
          ))}
        </div>
      </div>
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

function Scorecard({ rows, la, lb, onSource }: { rows: StreetRow[]; la: string; lb: string; onSource: (id: string) => void }) {
  return (
    <div className="mt-3 overflow-x-auto">
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
  );
}
