"use client";

import { useState } from "react";
import Link from "next/link";
import Info from "@/components/Info";
import DcfView from "@/components/DcfView";
import SourcePanel from "@/components/SourcePanel";
import { Cases, FactDetail, Refs, Streak, ValuationSlider } from "@/components/BriefView";
import type { StreakItem } from "@/lib/brief-extras";
import type { DcfModel } from "@/lib/dcf";
import type { Claim, StockCases } from "@/lib/filings";
import type { GuidanceItem } from "@/lib/types";
import { FootballField, PeHistoryChart, ReactionChart, RevisionsChart, type FieldRow, type ReactionPoint, type RevisionPoint } from "@/components/ValuationCharts";

export type EstimateRow = { horizon: string; period_end: string; eps_low: number | null; eps_avg: number | null; eps_high: number | null; revenue_avg: number | null; analysts: number | null };
export type StreetData = {
  ticker: string;
  price: number | null;
  priceDate: string | null;
  epsNtm: number | null;
  epsNtmMethod: string | null;
  peFwd: number | null;
  peAdjLtm: number | null;
  adjEpsLtm: number | null;
  peerMedianPe: number | null;
  estimates: EstimateRow[];
  streak: StreakItem[];
  guidance: { label: string; items: GuidanceItem[] } | null;
  cases: StockCases | null;
  dcf: DcfModel | null;
  field: FieldRow[];
  revisions: { name: string; points: RevisionPoint[] }[];
  firstSnapshot: string | null;
  reactions: ReactionPoint[];
};

const money = (v: number | null | undefined) =>
  v == null ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(2)}`;
const SECTIONS = [
  ["sv-value", "Valuation"],
  ["sv-estimates", "Estimates"],
  ["sv-guidance", "Guidance"],
  ["sv-cases", "Bull · Base · Bear"],
  ["sv-dcf", "DCF"],
] as const;

/** Forward-looking view: what the Street expects, what management guided, scenarios and the DCF. */
export default function StreetView({ d }: { d: StreetData }) {
  const [open, setOpen] = useState<string | null>(null);
  const caseFacts = d.cases?.facts ?? {};
  const order: string[] = [];
  for (const c of d.cases?.claims ?? []) for (const r of c.refs) if (!order.includes(r)) order.push(r);
  const refs = (c: Claim) => <Refs refs={c.refs} note={(r) => order.indexOf(r) + 1} onOpen={setOpen} />;
  const quarters = d.estimates.filter((e) => e.horizon === "fiscal quarter").slice(0, 4);
  const years = d.estimates.filter((e) => e.horizon === "fiscal year").slice(0, 2);
  const range = (e: EstimateRow) => (e.eps_low != null && e.eps_high != null ? `$${e.eps_low.toFixed(2)} – $${e.eps_high.toFixed(2)}` : "");
  const present = SECTIONS.filter(([id]) =>
    id === "sv-guidance" ? d.guidance?.items.length : id === "sv-cases" ? d.cases : id === "sv-dcf" ? d.dcf : id === "sv-value" ? d.field.length : true,
  );

  return (
    <div className="space-y-12">
      <nav aria-label="On this page" className="-mx-4 flex gap-2 overflow-x-auto px-4 text-sm">
        {present.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-border px-3.5 py-1.5 font-semibold text-muted hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>

      <section className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-border py-5 lg:grid-cols-4">
        <Stat label="Share price" value={d.price != null ? `$${d.price.toFixed(2)}` : "—"} sub={d.priceDate ? `as of ${d.priceDate}` : ""} />
        <Stat label="Next-12-months EPS (consensus)" info="consensus_eps" value={d.epsNtm != null ? `$${d.epsNtm.toFixed(2)}` : "—"} sub={d.adjEpsLtm != null ? `last 12 months: $${d.adjEpsLtm.toFixed(2)}` : ""} />
        <Stat
          label="Forward P/E"
          info="pe_fwd_ntm"
          value={d.peFwd != null ? `${d.peFwd.toFixed(1)}x` : "—"}
          sub={
            d.peerMedianPe != null
              ? `${d.peFwd != null ? (d.peFwd <= d.peerMedianPe ? "▲ below " : "▼ above ") : ""}peer median ${d.peerMedianPe.toFixed(1)}x`
              : ""
          }
          tone={d.peFwd != null && d.peerMedianPe != null ? (d.peFwd <= d.peerMedianPe ? "up" : "down") : undefined}
        />
        <Stat label="Street P/E (last 12 months)" info="pe_adj_ltm" value={d.peAdjLtm != null ? `${d.peAdjLtm.toFixed(1)}x` : "—"} sub="on adjusted EPS" />
      </section>

      {d.price && d.field.length > 0 && (
        <section id="sv-value" className="scroll-mt-28">
          <FootballField rows={d.field} price={d.price} />
        </section>
      )}

      {d.cases?.numbers.pe && d.cases.numbers.pe_series && d.cases.numbers.pe_series.length > 6 && (
        <PeHistoryChart series={d.cases.numbers.pe_series} p20={d.cases.numbers.pe.p20} p50={d.cases.numbers.pe.p50} p80={d.cases.numbers.pe.p80} current={d.peFwd} />
      )}

      {d.streak.length > 1 && <Streak items={d.streak} />}

      {d.reactions.length >= 4 && <ReactionChart points={d.reactions} />}

      <section id="sv-estimates" className="scroll-mt-28">
        <Head title="What analysts expect" info="consensus_eps" sub={d.epsNtmMethod ? `Next 12 months = ${d.epsNtmMethod}` : undefined} />
        {quarters.length + years.length === 0 ? (
          <p className="text-sm text-muted">No consensus estimates loaded yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-4 font-normal">Period ending</th>
                  <th className="py-2 pr-4 text-right font-normal">EPS</th>
                  <th className="py-2 pr-4 text-right font-normal">Range</th>
                  <th className="py-2 pr-4 text-right font-normal">
                    Revenue
                    <Info k="revenue_estimate" />
                  </th>
                  <th className="py-2 text-right font-normal">
                    Analysts
                    <Info k="analysts_count" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border border-t border-border">
                {[...quarters, ...years].map((e) => (
                  <tr key={e.horizon + e.period_end}>
                    <td className="py-3 pr-4">
                      {e.period_end}
                      <span className="ml-2 text-xs text-muted">{e.horizon === "fiscal year" ? "full year" : "quarter"}</span>
                    </td>
                    <td className="py-3 pr-4 text-right font-semibold tabular-nums">{e.eps_avg != null ? `$${e.eps_avg.toFixed(2)}` : "—"}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-muted">{range(e)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{money(e.revenue_avg)}</td>
                    <td className="py-3 text-right tabular-nums text-muted">{e.analysts ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Consensus estimates from Alpha Vantage, refreshed weekly. Periods are as the provider labels them.</p>
        <div className="mt-8">
          <RevisionsChart lines={d.revisions} firstDate={d.firstSnapshot} />
        </div>
      </section>

      {d.guidance && d.guidance.items.length > 0 && (
        <section id="sv-guidance" className="scroll-mt-28">
          <Head title="What management guided" info="guidance" sub={`From the ${d.guidance.label} earnings call`} more={{ href: "?tab=call", label: "Full call" }} />
          <ul className="divide-y divide-border">
            {d.guidance.items.map((g, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{g.metric}</span>
                  {g.period && <span className="ml-2 text-sm text-muted">{g.period}</span>}
                  <span className="mt-0.5 block text-sm text-muted">“{g.quote}”</span>
                </span>
                <span className="shrink-0 text-right font-semibold tabular-nums">{guideText(g)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.price && d.epsNtm && d.epsNtm > 0 && <ValuationSlider price={d.price} epsNtm={d.epsNtm} peerMedianPe={d.peerMedianPe} ticker={d.ticker} />}

      {d.cases && (
        <div id="sv-cases" className="scroll-mt-28">
          <Cases cases={d.cases} refs={refs} />
        </div>
      )}

      {d.dcf && (
        <div id="sv-dcf" className="scroll-mt-28">
          <DcfView ticker={d.ticker} dcf={d.dcf} />
        </div>
      )}

      {open && caseFacts[open] && (
        <SourcePanel title="Source" onClose={() => setOpen(null)}>
          <FactDetail fact={caseFacts[open]} />
        </SourcePanel>
      )}
      <p className="text-xs text-muted">
        Looking for what already happened? See{" "}
        <Link href="?tab=historical" className="text-accent underline">
          Historical
        </Link>
        .
      </p>
    </div>
  );
}

function guideText(g: GuidanceItem): string {
  if (g.withdrawn) return "Withdrawn";
  const u = (g.unit ?? "").toLowerCase();
  const f = (v: number) => (u.includes("%") || u.includes("percent") ? `${v}%` : u.includes("billion") ? `$${v}B` : u.includes("million") ? `$${v}M` : u.includes("usd") ? `$${v}` : `${v}`);
  if (g.low != null && g.high != null) return `${f(g.low)} – ${f(g.high)}`;
  if (g.point != null) return f(g.point);
  return g.qualitative ?? "";
}

function Stat({ label, value, sub, tone, info }: { label: string; value: string; sub?: string; tone?: "up" | "down"; info?: string }) {
  return (
    <div>
      <div className="flex items-center text-sm text-muted">
        {label}
        {info && <Info k={info} />}
      </div>
      <div className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      {sub && <div className={`mt-2 text-sm ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-muted"}`}>{sub}</div>}
    </div>
  );
}

function Head({ title, sub, more, info }: { title: string; sub?: string; more?: { href: string; label: string }; info?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-border pb-3">
      <div>
        <h3 className="flex items-center text-xl font-semibold tracking-tight">
          {title}
          {info && <Info k={info} />}
        </h3>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {more && (
        <Link href={more.href} className="shrink-0 text-sm font-semibold text-accent hover:underline">
          {more.label}
        </Link>
      )}
    </div>
  );
}
