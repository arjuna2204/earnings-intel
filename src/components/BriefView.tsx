"use client";

import { useState } from "react";
import Link from "next/link";
import SourcePanel from "@/components/SourcePanel";
import type { StreetRow } from "@/lib/figures";
import type { Brief, Claim, Dodge, Fact, StockCases, Take } from "@/lib/filings";
import type { Bridge, BriefExtras, StreakItem, Tile, Tone } from "@/lib/brief-extras";
import type { GuidanceChange, GuidanceItem } from "@/lib/types";

const SOURCE_KIND: Record<string, string> = { X: "Financials", S: "Street", C: "Call", F: "Filing", R: "Risk factors" };
const TONE_TEXT: Record<Tone, string> = { up: "text-up", down: "text-down", neutral: "text-muted", warn: "text-down" };
const ARROW: Partial<Record<Tone, string>> = { up: "▲", down: "▼", warn: "▼" };


/** The brief: Robinhood-style — type-driven, flat, thin dividers, color only for direction. */
export default function BriefView({
  brief,
  street,
  extras,
  la,
  lb,
  more,
}: {
  brief: Brief;
  street: StreetRow[];
  extras: BriefExtras;
  la: string;
  lb: string;
  more: {
    cik: number;
    ticker: string;
    valuation: { price: number; epsNtm: number; peerMedianPe: number | null } | null;
    dodges: Dodge[];
    takes: { current: Take | null; previous: Take | null };
    cases: StockCases | null;
  };
}) {
  const [open, setOpen] = useState<string | null>(null);
  const facts = { ...(more.cases?.facts ?? {}), ...brief.inputs.facts };
  const claims = (s: string) => brief.claims.filter((c) => c.section === s);
  // Number each cited fact once, in order of first appearance, like footnotes.
  const order: string[] = [];
  for (const c of [...brief.claims.filter((x) => x.section === "headline"), ...(more.cases?.claims ?? []), ...brief.claims])
    for (const r of c.refs) if (!order.includes(r)) order.push(r);
  const note = (r: string) => order.indexOf(r) + 1;
  const refs = (c: Claim) => <Refs refs={c.refs} note={note} onOpen={setOpen} />;
  const c = extras.counts;
  const jump = (k: string) => document.getElementById(`brief-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-12">
      {/* Summary: headline sentences, then the key numbers */}
      <section>
        {claims("headline").map((cl, i) => (
          <p key={i} className={i === 0 ? "text-2xl font-semibold leading-snug tracking-tight" : "mt-3 text-[17px] leading-relaxed"}>
            {cl.text}
            {refs(cl)}
          </p>
        ))}
        {extras.verdict.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {extras.verdict.map((v, i) => (
              <button key={i} onClick={() => jump(v.target)} className={`font-semibold hover:underline ${TONE_TEXT[v.tone]}`}>
                {ARROW[v.tone] ? `${ARROW[v.tone]} ` : ""}
                {v.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {more.cases && <Cases cases={more.cases} refs={refs} />}

      <Section id="street" title="The Street view">
        {extras.tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-border py-5 lg:grid-cols-4">
            {extras.tiles.map((t, i) => (
              <StatTile key={i} tile={t} />
            ))}
          </div>
        )}
        {extras.streak.length > 1 && <Streak items={extras.streak} />}
        {extras.bridge && <BridgeChart bridge={extras.bridge} lb={lb} />}
        <ClaimRows claims={claims("street")} refs={refs} />
        {more.valuation && <ValuationSlider {...more.valuation} ticker={more.ticker} />}
        {street.length > 0 && <Scorecard rows={street} la={la} lb={lb} onSource={setOpen} />}
      </Section>

      {claims("tensions").length > 0 && (
        <Section id="tensions" title="Worth a closer look" subtitle="Where what management said on the call and what the filing shows don't line up.">
          <div className="divide-y divide-border border-y border-border">
            {claims("tensions").map((cl, i) => (
              <Tension key={i} claim={cl} facts={facts} onOpen={setOpen} />
            ))}
          </div>
        </Section>
      )}

      {(claims("guidance").length > 0 || extras.guidance.length > 0) && (
        <Section
          id="guidance"
          title="Guidance"
          subtitle={[c.raised && `${c.raised} raised`, c.lowered && `${c.lowered} lowered`, c.added && `${c.added} new`, c.dropped && `${c.dropped} not repeated`].filter(Boolean).join(" · ") || undefined}
        >
          <GuidanceBars items={extras.guidance} la={la} lb={lb} />
          <ClaimRows claims={claims("guidance")} refs={refs} />
        </Section>
      )}

      {claims("results").length > 0 && (
        <Section id="results" title="Results">
          <ClaimRows claims={claims("results")} refs={refs} limit={4} />
        </Section>
      )}

      {claims("call").length > 0 && (
        <Section id="call" title="On the call" more={{ href: `?tab=call&a=${la}&b=${lb}`, label: "Full call comparison" }}>
          <ClaimRows claims={claims("call")} refs={refs} />
          {more.dodges.length > 0 && <Dodges items={more.dodges} />}
        </Section>
      )}

      {claims("risks").length > 0 && (
        <Section
          id="risks"
          title="Risk factors"
          subtitle={[c.riskAdded && `${c.riskAdded} added`, c.riskRemoved && `${c.riskRemoved} removed`, c.escalated && `${c.escalated} reworded more strongly`].filter(Boolean).join(" · ") || undefined}
          more={{ href: `?tab=filings&a=${la}&b=${lb}`, label: "Full redline" }}
        >
          <ClaimRows claims={claims("risks")} refs={refs} />
        </Section>
      )}

      <YourTake cik={more.cik} la={la} lb={lb} takes={more.takes} />

      <Sources order={order} facts={facts} onOpen={setOpen} />

      <p className="text-xs leading-relaxed text-muted">
        Written by AI only from the sources above and checked by code: every citation must exist and every number must appear in a cited
        source. Charts and figures are computed by code. {brief.dropped?.length ? `${brief.dropped.length} sentence(s) failed the check and were removed. ` : ""}
        Updated {new Date(brief.created_at).toLocaleDateString()}.
      </p>

      {open && facts[open] && (
        <SourcePanel title={SOURCE_KIND[open[0]] ?? "Source"} onClose={() => setOpen(null)}>
          <FactDetail fact={facts[open]} />
        </SourcePanel>
      )}
    </div>
  );
}

const CASE_LABEL = { bear: "Bear", base: "Base", bull: "Bull" } as const;

function Cases({ cases, refs }: { cases: StockCases; refs: (c: Claim) => React.ReactNode }) {
  const [pick, setPick] = useState<"bear" | "base" | "bull">("base");
  const n = cases.numbers;
  const sc = n.scenarios;
  const vals = sc ? (["bear", "base", "bull"] as const).map((k) => sc[k]?.value).filter((v): v is number => v != null) : [];
  const lo = Math.min(n.price, ...vals);
  const hi = Math.max(n.price, ...vals);
  const pad = (hi - lo || n.price) * 0.08;
  const pos = (v: number) => ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 100;
  const sel = sc?.[pick] ?? null;
  const caseClaims = cases.claims.filter((c) => c.section === pick);
  const watch = cases.claims.filter((c) => c.section === "watch");
  const color = (v: number) => (v >= 0 ? "text-up" : "text-down");
  return (
    <section id="brief-cases" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h3 className="text-xl font-semibold tracking-tight">Bull, base &amp; bear</h3>
        <div className="flex gap-1 text-sm" role="tablist">
          {(["bear", "base", "bull"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={pick === k}
              onClick={() => setPick(k)}
              className={`rounded-full px-3.5 py-1.5 font-semibold ${pick === k ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
            >
              {CASE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      {sc && vals.length > 0 && (
        <div className="mb-6">
          <div className="relative mx-2 h-16">
            <div className="absolute left-0 right-0 top-7 h-px bg-border" />
            {(["bear", "base", "bull"] as const).map((k) =>
              sc[k] ? (
                <button
                  key={k}
                  onClick={() => setPick(k)}
                  className="absolute top-0 -translate-x-1/2 text-center"
                  style={{ left: `${pos(sc[k]!.value)}%` }}
                  aria-label={`${CASE_LABEL[k]} case $${sc[k]!.value.toFixed(2)}`}
                >
                  <span className={`block text-xs font-semibold ${pick === k ? "text-foreground" : "text-muted"}`}>{CASE_LABEL[k]}</span>
                  <span className={`mx-auto mt-1.5 block h-3 w-3 rounded-full ${pick === k ? (sc[k]!.vs_price >= 0 ? "bg-up" : "bg-down") : "bg-muted/60"}`} />
                  <span className="mt-1 block text-xs tabular-nums text-muted">${sc[k]!.value.toFixed(0)}</span>
                </button>
              ) : null,
            )}
            <div className="absolute top-[22px] -translate-x-1/2" style={{ left: `${pos(n.price)}%` }}>
              <span className="block h-4 w-0.5 bg-foreground" />
            </div>
          </div>
          <p className="mt-1 text-center text-xs text-muted">│ today ${n.price.toFixed(2)}</p>
        </div>
      )}
      {sel ? (
        <div className="grid grid-cols-3 gap-6 border-y border-border py-4">
          <div>
            <div className="text-sm text-muted">{CASE_LABEL[pick]} value</div>
            <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums">${sel.value.toFixed(2)}</div>
            <div className={`mt-2 text-sm font-medium tabular-nums ${color(sel.vs_price)}`}>
              {sel.vs_price >= 0 ? "▲" : "▼"} {Math.abs(sel.vs_price * 100).toFixed(1)}% vs. today
            </div>
          </div>
          <div>
            <div className="text-sm text-muted">{pick === "bear" ? "Low" : pick === "bull" ? "High" : "Consensus"} EPS (next 12 mo.)</div>
            <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums">${sel.eps.toFixed(2)}</div>
            <div className="mt-2 text-sm text-muted">{n.analysts ? `${n.analysts} analysts` : "Analyst estimates"}</div>
          </div>
          <div>
            <div className="text-sm text-muted">P/E applied</div>
            <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums">{sel.pe.toFixed(1)}x</div>
            <div className="mt-2 text-sm text-muted">{pick === "bear" ? "20th pct" : pick === "bull" ? "80th pct" : "Median"} of its 5-yr range</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Scenario values need analyst estimates and 2+ years of price history.</p>
      )}
      {caseClaims.length > 0 && (
        <ul className="mt-4 divide-y divide-border">
          {caseClaims.map((c, i) => (
            <li key={i} className={`py-3 leading-relaxed first:pt-0 ${i === 0 ? "text-[17px] font-medium" : "text-[15px]"}`}>
              {c.text}
              {refs(c)}
            </li>
          ))}
        </ul>
      )}
      {watch.length > 0 && (
        <div className="mt-6">
          <div className="font-semibold">What to watch next quarter</div>
          <ul className="mt-2 divide-y divide-border">
            {watch.map((c, i) => (
              <li key={i} className="py-2.5 text-[15px] leading-relaxed">
                {c.text}
                {refs(c)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Scenario values are arithmetic, not forecasts: analysts&apos; low / consensus / high estimates for the next 12 months × the stock&apos;s own
        trailing P/E range over 5 years ({n.pe_samples} monthly readings). The reasoning is written by AI from the verified sources only.
      </p>
    </section>
  );
}

function ValuationSlider({ price, epsNtm, peerMedianPe, ticker }: { price: number; epsNtm: number; peerMedianPe: number | null; ticker: string }) {
  const [pct, setPct] = useState(0); // % change vs consensus
  const eps = epsNtm * (1 + pct / 100);
  const pe = eps > 0 ? price / eps : null;
  const basePe = price / epsNtm;
  return (
    <div>
      <div className="font-semibold">What if earnings come in different?</div>
      <p className="mt-0.5 text-sm text-muted">
        Drag to change next-12-months EPS from the analyst consensus (${epsNtm.toFixed(2)}) and see the forward P/E at today&apos;s price (${price.toFixed(2)}).
      </p>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <div className="text-sm text-muted">Next-12-months EPS</div>
          <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums">${eps.toFixed(2)}</div>
          <div className={`mt-2 text-sm font-medium ${pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-muted"}`}>
            {pct === 0 ? "Consensus" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs consensus`}
          </div>
        </div>
        <div>
          <div className="text-sm text-muted">Forward P/E</div>
          <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums">{pe ? `${pe.toFixed(1)}x` : "—"}</div>
          <div className="mt-2 text-sm text-muted">{basePe.toFixed(1)}x at consensus</div>
        </div>
        <div>
          <div className="text-sm text-muted">Peer median</div>
          <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums">{peerMedianPe ? `${peerMedianPe.toFixed(1)}x` : "—"}</div>
          <div className="mt-2 text-sm text-muted">{peerMedianPe ? "Forward P/E" : "Run Peers to compare"}</div>
        </div>
      </div>
      <input
        type="range"
        min={-30}
        max={30}
        step={1}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        aria-label={`Change ${ticker} next-12-months EPS versus consensus`}
        className="mt-5 w-full accent-[var(--color-accent,#00c805)]"
      />
      <div className="flex justify-between text-xs text-muted">
        <span>−30%</span>
        <button onClick={() => setPct(0)} className="hover:text-foreground">
          Reset
        </button>
        <span>+30%</span>
      </div>
    </div>
  );
}

function Dodges({ items }: { items: Dodge[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
  return (
    <div>
      <div className="font-semibold">Least direct answers</div>
      <p className="mt-0.5 text-sm text-muted">Analyst questions management answered least directly, scored 0 (direct) to 1 (avoided) by AI. Read the exchange and judge for yourself.</p>
      <ul className="mt-2 divide-y divide-border">
        {items.map((d, i) => (
          <li key={i} className="py-3">
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-baseline justify-between gap-4 text-left">
              <span className="min-w-0">
                <span className="font-medium">{d.analyst}</span>
                <span className="mt-0.5 block text-sm text-muted">{d.reason}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-down">{d.score.toFixed(1)}</span>
            </button>
            {open === i && (
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
                <p>
                  <span className="text-sm text-muted">Question · </span>
                  {cut(d.question, 900)}
                </p>
                <p>
                  <span className="text-sm text-muted">Answer{d.answerer ? ` (${d.answerer})` : ""} · </span>
                  {cut(d.answer, 1400)}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function YourTake({ cik, la, lb, takes }: { cik: number; la: string; lb: string; takes: { current: Take | null; previous: Take | null } }) {
  const [verdict, setVerdict] = useState<Take["verdict"] | null>(takes.current?.verdict ?? null);
  const [note, setNote] = useState(takes.current?.note ?? "");
  const [saved, setSaved] = useState<string | null>(takes.current ? "Saved" : null);
  const save = async (v: Take["verdict"], n: string) => {
    setSaved("Saving…");
    const res = await fetch("/api/takes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cik, period_a: la, period_b: lb, verdict: v, note: n }) });
    setSaved(res.ok ? "Saved" : "Couldn't save");
  };
  const word = { better: "Better", same: "About the same", worse: "Worse" } as const;
  const prev = takes.previous;
  return (
    <section>
      <h3 className="mb-1 border-b border-border pb-3 text-xl font-semibold tracking-tight">Your take</h3>
      {prev && (
        <p className="mt-3 text-[15px] leading-relaxed">
          <span className="text-muted">Last time ({prev.period_b} vs {prev.period_a}) you said </span>
          <b className={prev.verdict === "better" ? "text-up" : prev.verdict === "worse" ? "text-down" : ""}>{word[prev.verdict].toLowerCase()}</b>
          {prev.note && <span className="text-muted">: “{prev.note}”</span>}. Does this quarter confirm it?
        </p>
      )}
      <p className="mt-3 text-sm text-muted">
        Overall, is {lb} better or worse than {la}? Only you see this. Next quarter&apos;s brief will remind you what you said.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["better", "same", "worse"] as const).map((v) => (
          <button
            key={v}
            onClick={() => {
              setVerdict(v);
              save(v, note);
            }}
            aria-pressed={verdict === v}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              verdict === v ? (v === "better" ? "bg-up text-black" : v === "worse" ? "bg-down text-black" : "bg-foreground text-background") : "border border-border text-muted hover:text-foreground"
            }`}
          >
            {v === "better" ? "▲ " : v === "worse" ? "▼ " : ""}
            {word[v]}
          </button>
        ))}
      </div>
      {verdict && (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 600))}
            onBlur={() => save(verdict, note)}
            rows={2}
            placeholder="Why? (optional — e.g. “guide cut on memory costs; watch margins”)"
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-foreground"
          />
          {saved && <p className="mt-1 text-xs text-muted">{saved}</p>}
        </div>
      )}
    </section>
  );
}

function Section({
  id,
  title,
  subtitle,
  more,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  more?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section id={`brief-${id}`} className="scroll-mt-20">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <div>
          <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {more && (
          <Link href={more.href} className="shrink-0 text-sm font-semibold text-accent hover:underline">
            {more.label}
          </Link>
        )}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function Refs({ refs, note, onOpen }: { refs: string[]; note: (r: string) => number; onOpen: (id: string) => void }) {
  return (
    <sup className="ml-0.5 whitespace-nowrap">
      {refs.map((r, i) => (
        <button
          key={r}
          onClick={() => onOpen(r)}
          className="px-px text-[11px] font-semibold text-accent hover:underline"
          aria-label={`Source ${note(r)}: ${SOURCE_KIND[r[0]] ?? "source"}`}
        >
          {note(r)}
          {i < refs.length - 1 ? "," : ""}
        </button>
      ))}
    </sup>
  );
}

function ClaimRows({ claims, refs, limit }: { claims: Claim[]; refs: (c: Claim) => React.ReactNode; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!claims.length) return null;
  const shown = limit && !all ? claims.slice(0, limit) : claims;
  return (
    <div>
      <ul className="divide-y divide-border">
        {shown.map((c, i) => (
          <li key={i} className="py-3 text-[15px] leading-relaxed first:pt-0">
            {c.text}
            {refs(c)}
          </li>
        ))}
      </ul>
      {limit && claims.length > limit && (
        <button onClick={() => setAll(!all)} className="mt-1 text-sm font-semibold text-accent hover:underline">
          {all ? "Show less" : `Show ${claims.length - limit} more`}
        </button>
      )}
    </div>
  );
}

function StatTile({ tile }: { tile: Tile }) {
  return (
    <div>
      <div className="text-sm text-muted">{tile.label}</div>
      <div className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{tile.value}</div>
      <div className={`mt-2 text-sm font-medium tabular-nums ${TONE_TEXT[tile.tone]}`}>
        {ARROW[tile.tone] ? `${ARROW[tile.tone]} ` : ""}
        {tile.sub}
      </div>
    </div>
  );
}

function Streak({ items }: { items: StreakItem[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...items.map((i) => Math.abs(i.surprisePct)), 1);
  const beats = items.filter((i) => i.surprisePct >= 0).length;
  const cur = items[hover ?? items.length - 1];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">Earnings vs. estimates</span>
        <span className="text-sm text-muted">
          Beat {beats} of {items.length}
        </span>
      </div>
      <div className="mt-1 text-sm tabular-nums text-muted">
        {cur.label}: <span className="text-foreground">${cur.reported.toFixed(2)}</span> actual · ${cur.estimated.toFixed(2)} est. ·{" "}
        <span className={cur.surprisePct >= 0 ? "text-up" : "text-down"}>
          {cur.surprisePct >= 0 ? "▲" : "▼"} {Math.abs(cur.surprisePct).toFixed(1)}%
        </span>
      </div>
      <div className="mt-4 flex h-20 items-end gap-3" onMouseLeave={() => setHover(null)}>
        {items.map((it, i) => {
          const h = Math.max((Math.abs(it.surprisePct) / max) * 72, 3);
          const up = it.surprisePct >= 0;
          const dim = hover !== null && hover !== i;
          return (
            <button
              key={it.label}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(i)}
              aria-label={`${it.label}: ${up ? "beat" : "missed"} by ${Math.abs(it.surprisePct).toFixed(1)}%`}
              className="flex h-full flex-1 items-end justify-center"
            >
              <span className={`w-full max-w-7 rounded-full transition-opacity ${up ? "bg-up" : "bg-down"} ${dim ? "opacity-30" : ""}`} style={{ height: h }} />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3">
        {items.map((it) => (
          <span key={it.label} className="flex-1 text-center text-[11px] text-muted">
            {it.label.replace(/^FY\d{2}(\d{2})Q(\d)/, "Q$2 ’$1")}
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
  const cumulative = bridge.steps.map((_, i) => bridge.start + bridge.steps.slice(0, i + 1).reduce((t, x) => t + x.value, 0));
  const rows = [
    { label: bridge.startLabel, from: 0, to: bridge.start, kind: "total" as const, text: fmt(bridge.start) },
    ...bridge.steps.map((s, i) => ({
      label: s.label + (s.computed ? " (calculated)" : ""),
      from: i === 0 ? bridge.start : cumulative[i - 1],
      to: cumulative[i],
      kind: s.value >= 0 ? ("add" as const) : ("sub" as const),
      text: fmtD(s.value),
    })),
    { label: bridge.endLabel, from: 0, to: bridge.end, kind: "total" as const, text: fmt(bridge.end) },
  ];
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to)));
  const hi = Math.max(...rows.map((r) => Math.max(r.from, r.to)));
  const base = Math.max(lo, Math.min(bridge.start, bridge.end) - (hi - Math.min(bridge.start, bridge.end)) * 1.5 - Math.abs(hi) * 0.02);
  const span = hi - base || 1;
  const pos = (v: number) => ((Math.max(v, base) - base) / span) * 100;
  return (
    <div>
      <div className="font-semibold">GAAP to adjusted</div>
      <p className="mt-0.5 text-sm text-muted">
        {bridge.basis}, {lb}. What the company excludes to reach the figure analysts use.
      </p>
      <div className="mt-4 divide-y divide-border">
        {rows.map((r, i) => {
          const left = pos(Math.min(r.from, r.to));
          const width = Math.max(pos(Math.max(r.from, r.to)) - left, 0.8);
          const color = r.kind === "total" ? "bg-foreground" : r.kind === "add" ? "bg-up" : "bg-down";
          return (
            <div key={i} className="grid grid-cols-[minmax(0,9rem)_1fr_5.5rem] items-center gap-4 py-2.5 text-sm sm:grid-cols-[13rem_1fr_6rem]">
              <span className={`truncate ${r.kind === "total" ? "font-semibold" : "text-muted"}`} title={r.label}>
                {r.label}
              </span>
              <div className="relative h-1.5">
                <div className={`absolute top-0 h-1.5 rounded-full ${color}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
              <span className={`text-right tabular-nums ${r.kind === "total" ? "font-semibold" : r.kind === "add" ? "text-up" : "text-down"}`}>{r.text}</span>
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
    const l = u.toLowerCase();
    if (l.includes("%") || l.includes("percent")) return `${v}%`;
    if (l.includes("billion")) return `$${v}B`;
    if (l.includes("million")) return `$${v}M`;
    if (l.includes("usd")) return `$${v}`;
    return `${v} ${u}`;
  };
  const rangeText = (r: [number, number], u: string | null | undefined) => (r[0] === r[1] ? unitText(u, r[0]) : `${unitText(u, r[0])} – ${unitText(u, r[1])}`);
  const changeTone: Record<string, Tone> = { raised: "up", lowered: "down", withdrawn: "down", "not repeated": "down" };
  const changeWord: Record<string, string> = { raised: "Raised", lowered: "Lowered", new: "New", withdrawn: "Withdrawn", "not repeated": "Not repeated", "changed basis": "Changed basis", qualitative: "Qualitative" };
  return (
    <div>
      {numeric.length > 0 && (
        <>
          <div className="mb-2 flex gap-5 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-4 rounded-full bg-muted/40" /> Guided on {la} call
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-4 rounded-full bg-foreground" /> Guided on {lb} call
            </span>
          </div>
          <div className="divide-y divide-border">
            {numeric.map((g, i) => {
              const a = rangeOf(g.earlier)!;
              const b = rangeOf(g.later)!;
              const lo = Math.min(a[0], b[0]);
              const hi = Math.max(a[1], b[1]);
              const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
              const [min, max] = [lo - pad, hi + pad];
              const pos = (v: number) => ((v - min) / (max - min)) * 100;
              const bar = (r: [number, number], cls: string) => (
                <div className="relative h-1.5">
                  <div className={`absolute top-0 h-1.5 rounded-full ${cls}`} style={{ left: `${pos(r[0])}%`, width: `${Math.max(pos(r[1]) - pos(r[0]), 1.5)}%` }} />
                </div>
              );
              const tone = changeTone[g.change] ?? "neutral";
              return (
                <div key={i} className="py-3.5">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {g.metric}
                      {g.later?.period && <span className="ml-1.5 text-sm font-normal text-muted">{g.later.period}</span>}
                    </span>
                    <span className={`text-sm font-semibold ${TONE_TEXT[tone]}`}>
                      {ARROW[tone] ? `${ARROW[tone]} ` : ""}
                      {changeWord[g.change] ?? g.change}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_8rem] items-center gap-x-4 gap-y-1.5 text-sm">
                    {bar(a, "bg-muted/40")}
                    <span className="text-right tabular-nums text-muted">{rangeText(a, g.earlier?.unit)}</span>
                    {bar(b, "bg-foreground")}
                    <span className="text-right font-semibold tabular-nums">{rangeText(b, g.later?.unit)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {other.length > 0 && (
        <div className={`divide-y divide-border ${numeric.length ? "border-t border-border" : ""}`}>
          {other.map((g, i) => {
            const tone = changeTone[g.change] ?? "neutral";
            const q = (g.later ?? g.earlier)?.quote;
            return (
              <div key={i} className="flex items-baseline justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{g.metric}</span>
                  {q && <span className="mt-0.5 block truncate text-sm text-muted">“{q}”</span>}
                </span>
                <span className={`shrink-0 text-sm font-semibold ${TONE_TEXT[tone]}`}>{changeWord[g.change] ?? g.change}</span>
              </div>
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
    return f.quote && f.quote.length < 260 ? `“${f.quote}”` : f.text.length > 200 ? f.text.slice(0, 197) + "…" : f.text;
  };
  const col = (title: string, ids: string[]) => (
    <div>
      <div className="mb-1.5 text-sm text-muted">{title}</div>
      {ids.map((id) => (
        <button key={id} onClick={() => onOpen(id)} className="mb-2 block text-left text-[15px] leading-relaxed hover:text-accent">
          {snippet(id)}
        </button>
      ))}
    </div>
  );
  return (
    <div className="py-5">
      <p className="mb-4 font-medium leading-relaxed">{claim.text}</p>
      <div className="grid gap-5 md:grid-cols-2 md:gap-8">
        {col("On the call", said)}
        {col("In the filing and numbers", shows)}
      </div>
    </div>
  );
}

function Sources({ order, facts, onOpen }: { order: string[]; facts: Record<string, Fact>; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? order : order.slice(0, 5);
  return (
    <section>
      <h3 className="mb-3 border-b border-border pb-3 text-xl font-semibold tracking-tight">Sources</h3>
      <ol className="divide-y divide-border text-sm">
        {shown.map((id, i) => (
          <li key={id}>
            <button onClick={() => onOpen(id)} className="flex w-full gap-3 py-2.5 text-left hover:text-accent">
              <span className="w-5 shrink-0 font-semibold text-accent tabular-nums">{i + 1}</span>
              <span className="min-w-0">
                <span className="text-muted">{SOURCE_KIND[id[0]]} · </span>
                {facts[id]?.text.length > 160 ? facts[id].text.slice(0, 157) + "…" : facts[id]?.text}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {order.length > 5 && (
        <button onClick={() => setAll(!all)} className="mt-1 text-sm font-semibold text-accent hover:underline">
          {all ? "Show less" : `Show all ${order.length}`}
        </button>
      )}
    </section>
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
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <div>
      <div className="font-semibold">Scorecard</div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-2 pr-3 font-normal" />
            <th className="py-2 pr-3 text-right font-normal">{la}</th>
            <th className="py-2 text-right font-normal">{lb}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border border-t border-border">
          {shown.map((r, i) => (
            <tr key={i}>
              <td className="py-3 pr-3">
                {r.ref ? (
                  <button onClick={() => onSource(r.ref!)} className="text-left hover:text-accent">
                    {r.label}
                  </button>
                ) : (
                  r.label
                )}
                {r.note && <span className="mt-0.5 block text-xs text-muted">{r.note}</span>}
              </td>
              <td className="py-3 pr-3 text-right align-top tabular-nums text-muted">{r.a}</td>
              <td className={`py-3 text-right align-top font-semibold tabular-nums ${r.tone === "up" ? "text-up" : r.tone === "down" ? "text-down" : ""}`}>
                {r.tone === "up" ? "▲ " : r.tone === "down" ? "▼ " : ""}
                {r.b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 4 && (
        <button onClick={() => setAll(!all)} className="mt-1 text-sm font-semibold text-accent hover:underline">
          {all ? "Show less" : `Show ${rows.length - 4} more`}
        </button>
      )}
    </div>
  );
}
