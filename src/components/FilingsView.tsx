"use client";

import { useState } from "react";
import SourcePanel from "@/components/SourcePanel";
import { figureText } from "@/lib/figures";
import type { BriefInputs, Driver, Release, RiskChange } from "@/lib/filings";

type Panel = { title: string; quote: string; link?: string | null; label?: string } | null;

/** Filings tab: company-reported (non-GAAP) figures, MD&A drivers, and the risk-factor redline. */
export default function FilingsView({ inputs, risks, la, lb }: { inputs: BriefInputs; risks: RiskChange[]; la: string; lb: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const rb = inputs.results[lb]?.release;
  const ra = inputs.results[la]?.release;
  const mdna = inputs.results[lb]?.mdna;
  const fb = inputs.filings[lb];
  const relLink = (lbl: string) => inputs.filings[lbl]?.release?.url;

  return (
    <div className="space-y-10">
      <ReleaseTable rb={rb} ra={ra} la={la} lb={lb} onQuote={(q, lbl) => setPanel({ title: `${lbl} earnings release`, quote: q, link: relLink(lbl), label: "8-K filing" })} />

      {mdna && (
        <section>
          <h3 className="text-lg font-semibold">What drove {lb}, per management</h3>
          <p className="mb-3 text-xs text-muted">From MD&A in the {fb?.periodic?.form ?? "filing"} · tap any line for the exact passage</p>
          <DriverList
            drivers={mdna.drivers}
            onQuote={(d) => setPanel({ title: `${d.metric} — MD&A`, quote: d.quote, link: fb?.periodic?.url, label: `${fb?.periodic?.form} on SEC.gov` })}
          />
          {mdna.outlook.length > 0 && (
            <>
              <h4 className="mb-2 mt-6 font-semibold">Outlook stated in the filing</h4>
              <ul className="space-y-1.5 text-sm">
                {mdna.outlook.map((o, i) => (
                  <li key={i}>
                    <button className="text-left hover:text-accent" onClick={() => setPanel({ title: o.metric, quote: o.quote, link: fb?.periodic?.url, label: fb?.periodic?.form })}>
                      <b>{o.metric}:</b> {o.statement}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {mdna.capital.length > 0 && (
            <>
              <h4 className="mb-2 mt-6 font-semibold">Capital &amp; liquidity</h4>
              <ul className="space-y-1.5 text-sm">
                {mdna.capital.map((c, i) => (
                  <li key={i}>
                    <button className="text-left hover:text-accent" onClick={() => setPanel({ title: c.label, quote: c.quote, link: fb?.periodic?.url, label: fb?.periodic?.form })}>
                      <b>{c.label}:</b> {c.summary}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {mdna.competitors.length > 0 && (
            <p className="mt-6 text-sm">
              <b>Competitors named in the filing:</b>{" "}
              {mdna.competitors.map((c, i) => (
                <button key={i} className="mr-2 underline decoration-dotted hover:text-accent" onClick={() => setPanel({ title: c.name, quote: c.quote, link: fb?.periodic?.url, label: fb?.periodic?.form })}>
                  {c.name}
                </button>
              ))}
            </p>
          )}
        </section>
      )}

      <RiskSection inputs={inputs} risks={risks} />

      {panel && (
        <SourcePanel title={panel.title} onClose={() => setPanel(null)}>
          <blockquote className="border-l-2 border-accent pl-3 italic leading-relaxed">“{panel.quote}”</blockquote>
          {panel.link && (
            <a href={panel.link} target="_blank" rel="noreferrer" className="text-accent underline">
              Open {panel.label ?? "filing"} ↗
            </a>
          )}
          <p className="text-xs text-muted">Quoted exactly; the app checked this text appears word-for-word in the document.</p>
        </SourcePanel>
      )}
    </div>
  );
}

function ReleaseTable({ rb, ra, la, lb, onQuote }: { rb?: Release | null; ra?: Release | null; la: string; lb: string; onQuote: (q: string, lbl: string) => void }) {
  if (!rb && !ra) {
    return (
      <section className="text-sm text-muted">
        No earnings press release was found for these quarters, so company-reported adjusted figures aren&apos;t available. The app&apos;s own
        standardized adjusted figures are in Financials.
      </section>
    );
  }
  const kinds = [...new Set([...(rb?.figures ?? []), ...(ra?.figures ?? [])].map((f) => `${f.kind}|${f.label}`))];
  return (
    <section>
      <h3 className="text-lg font-semibold">Company-reported figures (earnings release)</h3>
      <p className="mb-3 text-xs text-muted">
        {rb?.reports_non_gaap ? "Includes the company's non-GAAP (adjusted) measures — usually what the Street compares to consensus." : "This company reports GAAP figures only in its release."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">As the company labels it</th>
              <th className="py-1.5 pr-3 text-right font-medium">{la}</th>
              <th className="py-1.5 text-right font-medium">{lb}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border border-t border-border">
            {kinds.map((k) => {
              const [kind, label] = k.split("|");
              const fB = rb?.figures.find((f) => f.kind === kind && f.label === label);
              const fA = ra?.figures.find((f) => f.kind === kind && f.label === label) ?? (fB?.prior !== null ? undefined : undefined);
              const aText = fA ? figureText(fA) : fB ? figureText(fB, "prior") : "—";
              const adjusted = /adjusted|core|ffo|affo/.test(kind);
              return (
                <tr key={k}>
                  <td className="py-3 pr-3">
                    {label}
                    {adjusted && <span className="ml-2 text-xs text-muted">non-GAAP</span>}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-muted">
                    {fA ? (
                      <button className="hover:text-accent" onClick={() => onQuote(fA.quote, la)}>{aText}</button>
                    ) : (
                      aText
                    )}
                  </td>
                  <td className="py-3 text-right font-semibold tabular-nums">
                    {fB ? <button className="hover:text-accent" onClick={() => onQuote(fB.quote, lb)}>{figureText(fB)}</button> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rb && rb.adjustments.length > 0 && (
        <div className="mt-4 text-sm">
          <b>What {lb}&apos;s adjusted figures exclude:</b>
          <ul className="mt-1 space-y-1">
            {rb.adjustments.map((a, i) => (
              <li key={i}>
                <button className="text-left hover:text-accent" onClick={() => onQuote(a.quote, lb)}>
                  • {a.label} <span className="text-muted">({a.applies_to})</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rb?.non_gaap_definition && <p className="mt-3 text-xs text-muted">“{rb.non_gaap_definition}”</p>}
    </section>
  );
}

function DriverList({ drivers, onQuote }: { drivers: Driver[]; onQuote: (d: Driver) => void }) {
  const groups = new Map<string, Driver[]>();
  for (const d of drivers) groups.set(d.metric, [...(groups.get(d.metric) ?? []), d]);
  return (
    <div className="grid gap-x-8 sm:grid-cols-2">
      {[...groups.entries()].map(([metric, ds]) => {
        const dir = ds.find((d) => !d.offset)?.direction ?? ds[0].direction;
        return (
          <div key={metric} className="border-b border-border py-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{metric}</span>
              <span className={`text-sm ${dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted"}`}>
                {dir === "up" ? "▲ " : dir === "down" ? "▼ " : ""}{ds.find((d) => d.change_text)?.change_text ?? dir}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {ds.map((d, i) => (
                <li key={i}>
                  <button className="text-left hover:text-accent" onClick={() => onQuote(d)}>
                    {d.offset ? <span className="text-muted">offset: </span> : null}
                    {d.driver}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  added: "text-up",
  removed: "text-down",
  modified: "text-foreground",
  unchanged: "text-muted",
};

function RiskSection({ inputs, risks }: { inputs: BriefInputs; risks: RiskChange[] }) {
  const [filter, setFilter] = useState<"changed" | "escalated" | "all">("changed");
  const [open, setOpen] = useState<number | null>(null);
  if (!inputs.risk) {
    return (
      <section>
        <h3 className="text-lg font-semibold">Risk factors</h3>
        <p className="mt-2 text-sm text-muted">
          Both quarters fall under the same annual report, so there is no risk-factor change to compare. Pick quarters from different
          fiscal years (for example the same quarter a year apart).
        </p>
      </section>
    );
  }
  const s = inputs.risk.summary;
  const shown = risks.filter((r) => (filter === "all" ? true : filter === "escalated" ? r.escalations.length > 0 : r.status !== "unchanged"));
  const wordChange = s.words_old ? ((s.words_new / s.words_old - 1) * 100).toFixed(0) : null;
  return (
    <section>
      <h3 className="text-lg font-semibold">Risk factors: what changed in the annual report</h3>
      <p className="mb-3 text-xs text-muted">
        10-K for period ending {s.report_new} vs. {s.report_old}. Matched and compared by code (no AI).
      </p>
      <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-5">
        {[
          ["Added", s.counts.added ?? 0],
          ["Removed", s.counts.removed ?? 0],
          ["Reworded", s.counts.modified ?? 0],
          ["Stronger wording", s.escalated],
          ["Length", wordChange !== null ? `${Number(wordChange) >= 0 ? "+" : ""}${wordChange}%` : "—"],
        ].map(([k, v]) => (
          <div key={String(k)}>
            <div className="text-sm text-muted">{k}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="mb-3 flex gap-2 text-sm">
        {(["changed", "escalated", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 font-semibold ${filter === f ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}>
            {f === "changed" ? "Changed" : f === "escalated" ? "Stronger wording" : "All"}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-border border-y border-border">
        {shown.map((r, i) => (
          <li key={i}>
            <button className="flex w-full items-start gap-3 py-4 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span className={`w-20 shrink-0 text-sm font-semibold capitalize ${STATUS_STYLE[r.status]}`}>{r.status === "modified" ? "Reworded" : r.status}</span>
              <span className="flex-1">
                <span className="font-medium">{r.headline}</span>
                {r.category && <span className="block text-xs text-muted">{r.category}</span>}
                {r.escalations.length > 0 && <span className="mt-1 block text-sm text-down">Stronger wording: {r.escalations[0]}</span>}
              </span>
              {r.status === "modified" && (
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  +{r.words_added} / −{r.words_removed} words
                </span>
              )}
            </button>
            {open === i && (
              <div className="pb-5 sm:pl-[5.75rem] text-sm leading-relaxed">
                {r.old_headline && r.old_headline !== r.headline && <p className="mb-2 text-xs text-muted">Previously: “{r.old_headline}”</p>}
                {r.escalations.length > 1 && (
                  <ul className="mb-3 space-y-1 text-sm text-down">
                    {r.escalations.map((e, k) => (
                      <li key={k}>{e}</li>
                    ))}
                  </ul>
                )}
                <Redline ops={r.redline} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Redline({ ops }: { ops: [string, string][] }) {
  if (!ops.length) return <p className="text-muted">No wording changes.</p>;
  return (
    <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap">
      {ops.map(([op, t], i) =>
        op === "=" ? (
          <span key={i} className="text-muted">
            {t.length > 400 ? `${t.slice(0, 180)} … ${t.slice(-180)}` : t}{" "}
          </span>
        ) : op === "+" ? (
          <ins key={i} className="bg-up/15 text-foreground no-underline">
            {t}{" "}
          </ins>
        ) : (
          <del key={i} className="bg-down/15 text-muted">
            {t}{" "}
          </del>
        ),
      )}
    </p>
  );
}
