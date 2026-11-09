"use client";

import Info from "@/components/Info";
import { useState } from "react";

type Horizon = "reaction" | "drift20" | "drift60";
type Stat = {
  n: number;
  enough: boolean;
  high_mean?: number | null;
  low_mean?: number | null;
  high_n?: number;
  low_n?: number;
  spread?: number | null;
  ci?: [number, number] | null;
  significant?: boolean;
  high_hit?: number | null;
  low_hit?: number | null;
  spearman?: number | null;
};
type SignalMeta = { title: string; explain: string; unit: string; kind: string; high_label: string; low_label: string; verdict: "edge" | "no_edge" | "not_enough_data" };
export type BacktestData = {
  summary: Record<string, { n: number; companies: number } & Record<Horizon, Stat>>;
  coverage: { events: number; companies: number; first: string | null; last: string | null; signals: Record<string, SignalMeta> };
  created_at: string;
};

const HORIZONS: { key: Horizon; label: string; long: string }[] = [
  { key: "reaction", label: "Next day", long: "on the first trading day after the news" },
  { key: "drift20", label: "1 month", long: "over the following 20 trading days" },
  { key: "drift60", label: "3 months", long: "over the following 60 trading days" },
];
const pct = (v: number | null | undefined, sign = true) => (v === null || v === undefined ? "—" : `${sign && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}%`);
const MIN = 20;

export default function BacktestView({ data }: { data: BacktestData }) {
  const [h, setH] = useState<Horizon>("drift20");
  const hz = HORIZONS.find((x) => x.key === h)!;
  const order = Object.keys(data.coverage.signals).sort((a, b) => {
    const rank = (k: string) => (data.coverage.signals[k].verdict === "edge" ? 0 : data.coverage.signals[k].verdict === "no_edge" ? 1 : 2);
    return rank(a) - rank(b);
  });
  const c = data.coverage;
  return (
    <div className="mt-8 space-y-10">
      <div className="grid grid-cols-3 gap-6 border-y border-border py-5">
        <div>
          <div className="text-sm text-muted">Events tested</div>
          <div className="mt-1 text-[26px] font-semibold tabular-nums">{c.events.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-sm text-muted">Companies</div>
          <div className="mt-1 text-[26px] font-semibold tabular-nums">{c.companies}</div>
        </div>
        <div>
          <div className="text-sm text-muted">Period</div>
          <div className="mt-1 text-[17px] font-semibold tabular-nums leading-tight">
            {c.first?.slice(0, 4)}–{c.last?.slice(0, 4)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Stock return minus its sector ETF, {hz.long}.</p>
        <div className="flex gap-1 text-sm" role="tablist">
          {HORIZONS.map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={h === x.key}
              onClick={() => setH(x.key)}
              className={`rounded-full px-3.5 py-1.5 font-semibold ${h === x.key ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <Forest data={data} order={order} h={h} />

      <div className="divide-y divide-border border-t border-border">
        {order.map((k) => (
          <SignalRow key={k} meta={c.signals[k]} stat={data.summary[k][h]} total={data.summary[k]} horizon={h} />
        ))}
      </div>

      <section className="space-y-3 text-sm leading-relaxed text-muted">
        <h2 className="text-lg font-semibold text-foreground">How to read this</h2>
        <p>
          Events are split into groups by the signal (top third vs. bottom third, or &ldquo;any&rdquo; vs. &ldquo;none&rdquo; for counts). The number is
          the difference in average return between the groups, after subtracting the sector ETF. The range is a 95% bootstrap range: if it
          crosses zero, the difference could easily be luck.
        </p>
        <p>
          &ldquo;Next day&rdquo; is the market&apos;s immediate reaction — it shows the signal matters, but you couldn&apos;t trade on it after the
          fact. &ldquo;1 month&rdquo; and &ldquo;3 months&rdquo; start <i>after</i> the reaction day, so they are the real test of whether a signal
          told you something the price hadn&apos;t absorbed yet.
        </p>
        <p>
          Limits: a few dozen large US companies, overlapping time periods, no trading costs, and only data this app has collected. Past
          relationships can disappear. This is research, not a trading recommendation. Transcripts and older annual reports are added every
          morning within the free data limits, so call and risk-factor signals get more reliable over time.
        </p>
        <p className="text-xs">Updated {new Date(data.created_at).toLocaleString()}.</p>
      </section>
    </div>
  );
}

/** All signals on one chart: the gap between high- and low-signal events, with its likely range. */
function Forest({ data, order, h }: { data: BacktestData; order: string[]; h: Horizon }) {
  const rows = order
    .map((k) => ({ k, meta: data.coverage.signals[k], st: data.summary[k][h] }))
    .filter((r) => r.st?.enough && r.st.ci && r.st.spread != null);
  if (!rows.length) return null;
  const ext = Math.max(0.02, ...rows.flatMap((r) => [Math.abs(r.st.ci![0]), Math.abs(r.st.ci![1])])) * 1.1;
  const pos = (v: number) => ((v + ext) / (2 * ext)) * 100;
  return (
    <div>
      <div className="flex items-center font-semibold">
        All signals at a glance
        <Info k="tercile_spread" />
      </div>
      <p className="mt-0.5 text-sm text-muted">Dot = difference in return between high- and low-signal events. Line = likely range. Crossing the middle line means it could be luck.</p>
      <div className="mt-4 space-y-3">
        {rows.map(({ k, meta, st }) => {
          const sig = st.significant;
          const color = !sig ? "bg-muted" : st.spread! > 0 ? "bg-up" : "bg-down";
          return (
            <div key={k} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr_5rem]">
              <span className="truncate" title={meta.title}>
                {meta.title}
              </span>
              <div className="relative h-5">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div className={`absolute top-2 h-1 rounded-full ${color} opacity-60`} style={{ left: `${pos(st.ci![0])}%`, width: `${pos(st.ci![1]) - pos(st.ci![0])}%` }} />
                <div className={`absolute top-1 h-3 w-3 -translate-x-1/2 rounded-full ${color}`} style={{ left: `${pos(st.spread!)}%` }} />
              </div>
              <span className={`text-right font-semibold tabular-nums ${!sig ? "text-muted" : st.spread! > 0 ? "text-up" : "text-down"}`}>{pct(st.spread)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] gap-3 text-[11px] text-muted sm:grid-cols-[14rem_1fr_5rem]">
        <span />
        <span className="flex justify-between">
          <span>{pct(-ext)}</span>
          <span>0</span>
          <span>{pct(ext)}</span>
        </span>
        <span />
      </div>
    </div>
  );
}

function SignalRow({ meta, stat, total, horizon }: { meta: SignalMeta; stat: Stat; total: { n: number; companies: number }; horizon: Horizon }) {
  const [open, setOpen] = useState(false);
  const enough = stat?.enough;
  const spread = stat?.spread ?? null;
  const tone = !enough ? "text-muted" : stat.significant ? (spread! > 0 ? "text-up" : "text-down") : "text-foreground";
  const verdictText = !enough
    ? `Not enough data yet — ${stat?.n ?? 0} of ${MIN} events`
    : stat.significant
      ? horizon === "reaction"
        ? "Moves the stock on the day"
        : "Shows an edge"
      : "No clear edge";
  const max = Math.max(Math.abs(stat?.high_mean ?? 0), Math.abs(stat?.low_mean ?? 0), 0.005);
  const bar = (v: number | null | undefined) => {
    const w = Math.min((Math.abs(v ?? 0) / max) * 50, 50);
    const pos = (v ?? 0) >= 0;
    return (
      <div className="relative h-1.5">
        <div className="absolute left-1/2 top-[-4px] h-[14px] w-px bg-border" />
        <div className={`absolute top-0 h-1.5 rounded-full ${pos ? "bg-up" : "bg-down"}`} style={pos ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
      </div>
    );
  };
  return (
    <div className="py-5">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-baseline justify-between gap-4 text-left">
        <span>
          <span className="block font-semibold">{meta.title}</span>
          <span className={`mt-0.5 block text-sm ${!enough ? "text-muted" : stat.significant ? tone : "text-muted"}`}>{verdictText}</span>
        </span>
        <span className={`shrink-0 text-right text-[22px] font-semibold tabular-nums ${tone}`}>
          {enough ? (
            <>
              {spread! > 0 ? "▲ " : spread! < 0 ? "▼ " : ""}
              {pct(spread)}
            </>
          ) : (
            "—"
          )}
        </span>
      </button>
      {enough && (
        <p className="mt-1 text-sm text-muted">
          {meta.high_label} vs. {meta.low_label.toLowerCase()} · likely range {pct(stat.ci?.[0])} to {pct(stat.ci?.[1])}
        </p>
      )}
      {open && (
        <div className="mt-4 space-y-4 text-sm">
          <p className="leading-relaxed text-muted">{meta.explain}</p>
          {enough && (
            <div className="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem] items-center gap-x-4 gap-y-3">
              <span>
                {meta.high_label}
                <span className="block text-xs text-muted">
                  {stat.high_n} events · beat sector {pct(stat.high_hit, false)} of the time
                </span>
              </span>
              {bar(stat.high_mean)}
              <span className="text-right font-semibold tabular-nums">{pct(stat.high_mean)}</span>
              <span>
                {meta.low_label}
                <span className="block text-xs text-muted">
                  {stat.low_n} events · beat sector {pct(stat.low_hit, false)} of the time
                </span>
              </span>
              {bar(stat.low_mean)}
              <span className="text-right font-semibold tabular-nums">{pct(stat.low_mean)}</span>
            </div>
          )}
          <p className="text-xs text-muted">
            {total.n} events across {total.companies} companies
            {stat?.spearman !== null && stat?.spearman !== undefined ? ` · rank correlation ${stat.spearman.toFixed(2)}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
